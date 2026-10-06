import sqlite3
from datetime import date, datetime, time

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/inventory", tags=["inventory"])

PURCHASE_SOURCE_TYPES = {"PURCHASE_RECEIPT", "PURCHASE_RECEIPT_VOID"}
SALE_SOURCE_TYPES = {"SALE", "SALE_VOID"}
ADJUSTMENT_SOURCE_TYPES = {"STOCK_ADJUSTMENT"}

MOVEMENT_FILTERS = {"ALL", "PURCHASE", "SALE", "ADJUSTMENT", "OTHER"}


class InventoryStockItem(BaseModel):
    item_id: int
    item_name: str
    item_group_id: int
    item_group_name: str
    smallest_unit_id: int
    smallest_unit_name: str
    stock_quantity: float
    last_purchase_time: str | None
    last_purchase_receipt_code: str | None
    last_purchase_unit_id: int | None
    last_purchase_unit_name: str | None
    last_purchase_unit_price: int | None
    last_purchase_price_per_smallest_unit: float | None
    last_reconciled_at: str | None
    last_reconciled_quantity: float | None


class InventoryMovementOutput(BaseModel):
    id: int
    movement_time: str
    source_type: str
    movement_kind: str
    movement_label: str
    source_id: str | None
    source_line_id: str | None
    reference_code: str | None
    quantity_delta: float
    running_quantity: float
    note: str | None


class InventoryHistorySummary(BaseModel):
    opening_quantity: float
    purchase_delta: float
    sales_delta: float
    adjustment_delta: float
    other_delta: float
    closing_quantity: float


class InventoryItemHistory(BaseModel):
    item_id: int
    item_name: str
    item_group_name: str
    smallest_unit_id: int
    smallest_unit_name: str
    from_time: str
    to_time: str
    movement_filter: str
    summary: InventoryHistorySummary
    items: list[InventoryMovementOutput]


class StockAdjustmentInput(BaseModel):
    item_id: int
    actual_quantity: float = Field(ge=0)
    adjustment_time: str | None = None
    reason: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=500)


class StockAdjustmentOutput(BaseModel):
    id: int
    adjustment_code: str
    adjustment_time: str
    item_id: int
    item_name: str
    smallest_unit_name: str
    system_quantity: float
    actual_quantity: float
    quantity_delta: float
    reason: str | None
    note: str | None
    created_at: str


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def normalize_datetime(
    value: str,
    *,
    end_of_day: bool = False,
) -> str:
    cleaned = value.strip()
    try:
        if len(cleaned) == 10:
            parsed_date = date.fromisoformat(cleaned)
            parsed = datetime.combine(
                parsed_date,
                time.max if end_of_day else time.min,
            )
        else:
            parsed = datetime.fromisoformat(cleaned)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Thời gian không hợp lệ.",
        ) from exc

    return parsed.isoformat(timespec="microseconds")


def movement_kind(source_type: str) -> str:
    if source_type in PURCHASE_SOURCE_TYPES:
        return "PURCHASE"
    if source_type in SALE_SOURCE_TYPES:
        return "SALE"
    if source_type in ADJUSTMENT_SOURCE_TYPES:
        return "ADJUSTMENT"
    return "OTHER"


def movement_label(source_type: str) -> str:
    labels = {
        "PURCHASE_RECEIPT": "Nhập hàng",
        "PURCHASE_RECEIPT_VOID": "Hủy phiếu nhập",
        "SALE": "Bán hàng",
        "SALE_VOID": "Hủy bán hàng",
        "STOCK_ADJUSTMENT": "Đối chiếu tồn",
    }
    return labels.get(source_type, "Biến động khác")


def current_quantity(
    connection: sqlite3.Connection,
    item_id: int,
    *,
    as_of: str | None = None,
) -> float:
    if as_of is None:
        row = connection.execute(
            """
            SELECT COALESCE(SUM(quantity_delta), 0) AS quantity
            FROM inventory_movements
            WHERE item_id = ?
            """,
            (item_id,),
        ).fetchone()
    else:
        row = connection.execute(
            """
            SELECT COALESCE(SUM(quantity_delta), 0) AS quantity
            FROM inventory_movements
            WHERE item_id = ?
              AND movement_time <= ?
            """,
            (item_id, as_of),
        ).fetchone()
    return float(row["quantity"])


def last_purchase(
    connection: sqlite3.Connection,
    item_id: int,
    *,
    as_of: str,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            r.receipt_time,
            r.receipt_code,
            pri.unit_id,
            u.name AS unit_name,
            pri.unit_price,
            pri.conversion_factor
        FROM purchase_receipt_items AS pri
        JOIN purchase_receipts AS r ON r.id = pri.purchase_receipt_id
        JOIN units AS u ON u.id = pri.unit_id
        WHERE pri.item_id = ?
          AND r.is_void = 0
          AND r.receipt_time <= ?
        ORDER BY r.receipt_time DESC, pri.id DESC
        LIMIT 1
        """,
        (item_id, as_of),
    ).fetchone()


def last_reconciliation(
    connection: sqlite3.Connection,
    item_id: int,
    *,
    as_of: str,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            sa.adjustment_time,
            sai.actual_quantity
        FROM stock_adjustment_items AS sai
        JOIN stock_adjustments AS sa ON sa.id = sai.stock_adjustment_id
        WHERE sai.item_id = ?
          AND sa.adjustment_time <= ?
        ORDER BY sa.adjustment_time DESC, sai.id DESC
        LIMIT 1
        """,
        (item_id, as_of),
    ).fetchone()


def resolve_reference_code(
    connection: sqlite3.Connection,
    source_type: str,
    source_id: str | None,
) -> str | None:
    if not source_id:
        return None

    if source_type in PURCHASE_SOURCE_TYPES:
        row = connection.execute(
            "SELECT receipt_code FROM purchase_receipts WHERE CAST(id AS TEXT) = ?",
            (source_id,),
        ).fetchone()
        return row["receipt_code"] if row else source_id

    if source_type == "STOCK_ADJUSTMENT":
        row = connection.execute(
            "SELECT adjustment_code FROM stock_adjustments WHERE CAST(id AS TEXT) = ?",
            (source_id,),
        ).fetchone()
        return row["adjustment_code"] if row else source_id

    if source_type in SALE_SOURCE_TYPES:
        row = connection.execute(
            "SELECT order_code FROM sales_orders WHERE CAST(id AS TEXT) = ?",
            (source_id,),
        ).fetchone()
        return row["order_code"] if row else source_id

    return source_id


def next_adjustment_code(
    connection: sqlite3.Connection,
    adjustment_time: str,
) -> str:
    day_key = datetime.fromisoformat(adjustment_time).strftime("%Y%m%d")
    pattern = f"DC-{day_key}-%"
    row = connection.execute(
        """
        SELECT COUNT(*) AS total
        FROM stock_adjustments
        WHERE adjustment_code LIKE ?
        """,
        (pattern,),
    ).fetchone()
    return f"DC-{day_key}-{int(row['total']) + 1:03d}"


@router.get("/stock", response_model=list[InventoryStockItem])
def list_inventory_stock(
    search: str | None = Query(default=None),
    group_id: int | None = Query(default=None),
    as_of: str | None = Query(default=None),
) -> list[InventoryStockItem]:
    as_of_time = (
        normalize_datetime(as_of, end_of_day=True)
        if as_of
        else datetime.now().isoformat(timespec="microseconds")
    )

    conditions: list[str] = []
    params: list[object] = []

    if group_id is not None:
        conditions.append("i.item_group_id = ?")
        params.append(group_id)

    if search and search.strip():
        conditions.append("i.name LIKE ? COLLATE NOCASE")
        params.append(f"%{search.strip()}%")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with connect() as connection:
        rows = connection.execute(
            f"""
            SELECT
                i.id,
                i.name,
                i.item_group_id,
                g.name AS item_group_name,
                i.smallest_unit_id,
                u.name AS smallest_unit_name
            FROM items AS i
            JOIN item_groups AS g ON g.id = i.item_group_id
            JOIN units AS u ON u.id = i.smallest_unit_id
            {where}
            ORDER BY i.is_active DESC, i.name COLLATE NOCASE ASC, i.id ASC
            """,
            tuple(params),
        ).fetchall()

        result: list[InventoryStockItem] = []
        for row in rows:
            purchase = last_purchase(
                connection,
                row["id"],
                as_of=as_of_time,
            )
            reconciliation = last_reconciliation(
                connection,
                row["id"],
                as_of=as_of_time,
            )

            price_per_smallest: float | None = None
            if purchase is not None:
                factor = float(purchase["conversion_factor"])
                if factor > 0:
                    price_per_smallest = float(purchase["unit_price"]) / factor

            result.append(
                InventoryStockItem(
                    item_id=row["id"],
                    item_name=row["name"],
                    item_group_id=row["item_group_id"],
                    item_group_name=row["item_group_name"],
                    smallest_unit_id=row["smallest_unit_id"],
                    smallest_unit_name=row["smallest_unit_name"],
                    stock_quantity=current_quantity(
                        connection,
                        row["id"],
                        as_of=as_of_time,
                    ),
                    last_purchase_time=(
                        purchase["receipt_time"] if purchase else None
                    ),
                    last_purchase_receipt_code=(
                        purchase["receipt_code"] if purchase else None
                    ),
                    last_purchase_unit_id=(
                        purchase["unit_id"] if purchase else None
                    ),
                    last_purchase_unit_name=(
                        purchase["unit_name"] if purchase else None
                    ),
                    last_purchase_unit_price=(
                        purchase["unit_price"] if purchase else None
                    ),
                    last_purchase_price_per_smallest_unit=price_per_smallest,
                    last_reconciled_at=(
                        reconciliation["adjustment_time"]
                        if reconciliation
                        else None
                    ),
                    last_reconciled_quantity=(
                        float(reconciliation["actual_quantity"])
                        if reconciliation
                        else None
                    ),
                )
            )

        return result


@router.get(
    "/items/{item_id}/history",
    response_model=InventoryItemHistory,
)
def get_inventory_item_history(
    item_id: int,
    from_time: str = Query(alias="from"),
    to_time: str = Query(alias="to"),
    movement_filter: str = Query(default="ALL", alias="type"),
) -> InventoryItemHistory:
    start = normalize_datetime(from_time, end_of_day=False)
    end = normalize_datetime(to_time, end_of_day=True)

    if start > end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Từ ngày phải nhỏ hơn hoặc bằng đến ngày.",
        )

    normalized_filter = movement_filter.strip().upper()
    if normalized_filter not in MOVEMENT_FILTERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loại biến động kho không hợp lệ.",
        )

    with connect() as connection:
        item = connection.execute(
            """
            SELECT
                i.id,
                i.name,
                g.name AS item_group_name,
                i.smallest_unit_id,
                u.name AS smallest_unit_name
            FROM items AS i
            JOIN item_groups AS g ON g.id = i.item_group_id
            JOIN units AS u ON u.id = i.smallest_unit_id
            WHERE i.id = ?
            """,
            (item_id,),
        ).fetchone()
        if item is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy hàng hóa.",
            )

        opening = connection.execute(
            """
            SELECT COALESCE(SUM(quantity_delta), 0) AS quantity
            FROM inventory_movements
            WHERE item_id = ?
              AND movement_time < ?
            """,
            (item_id, start),
        ).fetchone()
        opening_quantity = float(opening["quantity"])

        rows = connection.execute(
            """
            SELECT
                id,
                movement_time,
                quantity_delta,
                source_type,
                source_id,
                source_line_id,
                note
            FROM inventory_movements
            WHERE item_id = ?
              AND movement_time >= ?
              AND movement_time <= ?
            ORDER BY movement_time ASC, id ASC
            """,
            (item_id, start, end),
        ).fetchall()

        purchase_delta = 0.0
        sales_delta = 0.0
        adjustment_delta = 0.0
        other_delta = 0.0
        running = opening_quantity
        visible_items: list[InventoryMovementOutput] = []

        for row in rows:
            delta = float(row["quantity_delta"])
            kind = movement_kind(row["source_type"])
            running += delta

            if kind == "PURCHASE":
                purchase_delta += delta
            elif kind == "SALE":
                sales_delta += delta
            elif kind == "ADJUSTMENT":
                adjustment_delta += delta
            else:
                other_delta += delta

            if normalized_filter != "ALL" and kind != normalized_filter:
                continue

            visible_items.append(
                InventoryMovementOutput(
                    id=row["id"],
                    movement_time=row["movement_time"],
                    source_type=row["source_type"],
                    movement_kind=kind,
                    movement_label=movement_label(row["source_type"]),
                    source_id=row["source_id"],
                    source_line_id=row["source_line_id"],
                    reference_code=resolve_reference_code(
                        connection,
                        row["source_type"],
                        row["source_id"],
                    ),
                    quantity_delta=delta,
                    running_quantity=running,
                    note=row["note"],
                )
            )

        closing_quantity = (
            opening_quantity
            + purchase_delta
            + sales_delta
            + adjustment_delta
            + other_delta
        )

        return InventoryItemHistory(
            item_id=item["id"],
            item_name=item["name"],
            item_group_name=item["item_group_name"],
            smallest_unit_id=item["smallest_unit_id"],
            smallest_unit_name=item["smallest_unit_name"],
            from_time=start,
            to_time=end,
            movement_filter=normalized_filter,
            summary=InventoryHistorySummary(
                opening_quantity=opening_quantity,
                purchase_delta=purchase_delta,
                sales_delta=sales_delta,
                adjustment_delta=adjustment_delta,
                other_delta=other_delta,
                closing_quantity=closing_quantity,
            ),
            items=visible_items,
        )


@router.post(
    "/adjustments",
    response_model=StockAdjustmentOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_stock_adjustment(
    payload: StockAdjustmentInput,
) -> StockAdjustmentOutput:
    adjustment_time = (
        normalize_datetime(payload.adjustment_time)
        if payload.adjustment_time
        else datetime.now().isoformat(timespec="microseconds")
    )
    reason = clean_text(payload.reason) or "Đối chiếu tồn"
    note = clean_text(payload.note)

    with connect() as connection:
        item = connection.execute(
            """
            SELECT
                i.id,
                i.name,
                u.name AS smallest_unit_name
            FROM items AS i
            JOIN units AS u ON u.id = i.smallest_unit_id
            WHERE i.id = ?
            """,
            (payload.item_id,),
        ).fetchone()
        if item is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy hàng hóa.",
            )

        system_quantity = current_quantity(
            connection,
            payload.item_id,
            as_of=adjustment_time,
        )
        actual_quantity = float(payload.actual_quantity)
        delta = actual_quantity - system_quantity
        adjustment_code = next_adjustment_code(connection, adjustment_time)

        cursor = connection.execute(
            """
            INSERT INTO stock_adjustments (
                adjustment_code,
                adjustment_time,
                reason,
                note,
                created_at
            )
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                adjustment_code,
                adjustment_time,
                reason,
                note,
            ),
        )
        adjustment_id = int(cursor.lastrowid)

        item_cursor = connection.execute(
            """
            INSERT INTO stock_adjustment_items (
                stock_adjustment_id,
                item_id,
                system_quantity,
                actual_quantity,
                quantity_delta,
                note
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                adjustment_id,
                payload.item_id,
                system_quantity,
                actual_quantity,
                delta,
                note,
            ),
        )

        connection.execute(
            """
            INSERT INTO inventory_movements (
                item_id,
                movement_time,
                quantity_delta,
                source_type,
                source_id,
                source_line_id,
                note,
                created_at
            )
            VALUES (?, ?, ?, 'STOCK_ADJUSTMENT', ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                payload.item_id,
                adjustment_time,
                delta,
                str(adjustment_id),
                str(int(item_cursor.lastrowid)),
                reason if note is None else f"{reason} - {note}",
            ),
        )
        connection.commit()

        created = connection.execute(
            """
            SELECT created_at
            FROM stock_adjustments
            WHERE id = ?
            """,
            (adjustment_id,),
        ).fetchone()

        output = StockAdjustmentOutput(
            id=adjustment_id,
            adjustment_code=adjustment_code,
            adjustment_time=adjustment_time,
            item_id=item["id"],
            item_name=item["name"],
            smallest_unit_name=item["smallest_unit_name"],
            system_quantity=system_quantity,
            actual_quantity=actual_quantity,
            quantity_delta=delta,
            reason=reason,
            note=note,
            created_at=created["created_at"],
        )

    backup_database(reason="stock-adjustment-created")
    return output
