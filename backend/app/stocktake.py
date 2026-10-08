"""Offline-safe multi-item stocktaking.

One stocktake produces one stock_adjustments header, N lines and N movements.
Server-side revisions prevent stale phone counts overwriting subsequent sales.
"""
import hashlib
import json
import sqlite3
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect
from .inventory import current_quantity, current_revision, next_adjustment_code

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


class StocktakeLineInput(BaseModel):
    item_id: int = Field(gt=0)
    expected_quantity: float = Field(allow_inf_nan=False)
    expected_revision: int = Field(ge=0)
    actual_quantity: float = Field(ge=0, allow_inf_nan=False)


class StocktakeBatchInput(BaseModel):
    client_sync_id: str = Field(min_length=8, max_length=80)
    reason: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=500)
    items: list[StocktakeLineInput] = Field(min_length=1, max_length=1000)


class StocktakeLineOutput(BaseModel):
    item_id: int
    item_name: str
    smallest_unit_name: str
    system_quantity: float
    actual_quantity: float
    quantity_delta: float


class StocktakeBatchOutput(BaseModel):
    id: int
    adjustment_code: str
    adjustment_time: str
    client_sync_id: str
    already_synced: bool
    items: list[StocktakeLineOutput]


def clean_text(value: str | None) -> str | None:
    return value.strip() or None if value is not None else None


def fingerprint(payload: StocktakeBatchInput) -> str:
    # Equivalent reordered lines must produce the same idempotency fingerprint.
    normalized = {
        "reason": clean_text(payload.reason) or "Kiểm kho",
        "note": clean_text(payload.note),
        "items": [
            {
                "item_id": row.item_id,
                "expected_quantity": row.expected_quantity,
                "expected_revision": row.expected_revision,
                "actual_quantity": row.actual_quantity,
            }
            for row in sorted(payload.items, key=lambda row: row.item_id)
        ],
    }
    encoded = json.dumps(
        normalized, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def get_response(
    connection: sqlite3.Connection,
    adjustment: sqlite3.Row,
    *,
    already_synced: bool,
) -> StocktakeBatchOutput:
    rows = connection.execute(
        """
        SELECT sai.item_id, i.name AS item_name,
               u.name AS smallest_unit_name, sai.system_quantity,
               sai.actual_quantity, sai.quantity_delta
        FROM stock_adjustment_items AS sai
        JOIN items AS i ON i.id = sai.item_id
        JOIN units AS u ON u.id = i.smallest_unit_id
        WHERE sai.stock_adjustment_id = ?
        ORDER BY sai.id
        """,
        (adjustment["id"],),
    ).fetchall()
    return StocktakeBatchOutput(
        id=adjustment["id"],
        adjustment_code=adjustment["adjustment_code"],
        adjustment_time=adjustment["adjustment_time"],
        client_sync_id=adjustment["client_sync_id"],
        already_synced=already_synced,
        items=[StocktakeLineOutput(**dict(row)) for row in rows],
    )


@router.post(
    "/adjustments/batch",
    response_model=StocktakeBatchOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_stocktake_batch(payload: StocktakeBatchInput) -> StocktakeBatchOutput:
    ids = [row.item_id for row in payload.items]
    if len(set(ids)) != len(ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Mỗi hàng hóa chỉ được kiểm một lần trong phiếu.",
        )

    request_hash = fingerprint(payload)
    with connect() as connection:
        # Lock before checking the revision so a concurrent sale cannot
        # commit between the check and stock movement insertion.
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            """
            SELECT * FROM stock_adjustments
            WHERE client_sync_id = ?
            """,
            (payload.client_sync_id,),
        ).fetchone()
        if existing is not None:
            if existing["client_payload_hash"] != request_hash:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "SYNC_ID_REUSED",
                        "message": "Mã đồng bộ đã dùng cho một phiếu khác.",
                    },
                )
            return get_response(connection, existing, already_synced=True)

        recorded_at = datetime.now().isoformat(timespec="microseconds")
        prepared = []
        conflicts = []
        for row in payload.items:
            item = connection.execute(
                """
                SELECT i.id, i.name, i.is_stock_tracked
                FROM items AS i WHERE i.id = ?
                """,
                (row.item_id,),
            ).fetchone()
            if item is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Không tìm thấy mặt hàng #{row.item_id}.",
                )
            quantity = current_quantity(connection, row.item_id, as_of=recorded_at)
            revision = current_revision(connection, row.item_id)
            if (
                not item["is_stock_tracked"]
                or revision != row.expected_revision
                or abs(quantity - row.expected_quantity) > 0.000001
            ):
                conflicts.append({
                    "item_id": row.item_id,
                    "item_name": item["name"],
                    "current_quantity": quantity,
                    "current_revision": revision,
                    "is_stock_tracked": bool(item["is_stock_tracked"]),
                })
            prepared.append((row, quantity))

        if conflicts:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "STOCK_CHANGED",
                    "message": (
                        "Tồn kho hoặc trạng thái theo dõi đã thay đổi. "
                        "Tải lại số tồn và đối chiếu trước khi đồng bộ."
                    ),
                    "items": conflicts,
                },
            )

        reason = clean_text(payload.reason) or "Kiểm kho"
        note = clean_text(payload.note)
        adjustment_code = next_adjustment_code(connection, recorded_at)
        cursor = connection.execute(
            """
            INSERT INTO stock_adjustments (
                adjustment_code, adjustment_time, reason, note, created_at,
                client_sync_id, client_payload_hash
            )
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
            """,
            (
                adjustment_code, recorded_at, reason, note,
                payload.client_sync_id, request_hash,
            ),
        )
        adjustment_id = int(cursor.lastrowid)

        for row, quantity in prepared:
            delta = row.actual_quantity - quantity
            item_cursor = connection.execute(
                """
                INSERT INTO stock_adjustment_items (
                    stock_adjustment_id, item_id, system_quantity,
                    actual_quantity, quantity_delta, note
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    adjustment_id, row.item_id, quantity,
                    row.actual_quantity, delta, note,
                ),
            )
            movement_note = reason if note is None else f"{reason} - {note}"
            connection.execute(
                """
                INSERT INTO inventory_movements (
                    item_id, movement_time, quantity_delta, source_type,
                    source_id, source_line_id, note, created_at
                )
                VALUES (?, ?, ?, 'STOCK_ADJUSTMENT', ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    row.item_id, recorded_at, delta, str(adjustment_id),
                    str(int(item_cursor.lastrowid)), movement_note,
                ),
            )

        inserted = connection.execute(
            "SELECT * FROM stock_adjustments WHERE id = ?", (adjustment_id,)
        ).fetchone()
        result = get_response(connection, inserted, already_synced=False)
        connection.commit()

    backup_database(reason="stocktake-batch-created")
    return result
