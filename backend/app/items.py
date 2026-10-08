import sqlite3
import unicodedata

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/items", tags=["items"])


class ItemUnitConversionInput(BaseModel):
    unit_id: int
    quantity_in_smallest_unit: float = Field(gt=0)
    is_active: bool = True


class ItemUnitConversionOutput(ItemUnitConversionInput):
    id: int
    unit_name: str


class ItemInput(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    item_group_id: int
    default_unit_id: int
    smallest_unit_id: int
    note: str | None = Field(default=None, max_length=500)
    is_active: bool = True
    # None keeps the previous setting on legacy PUT clients.
    is_stock_tracked: bool | None = None
    conversions: list[ItemUnitConversionInput] = Field(default_factory=list)


class ItemOutput(BaseModel):
    id: int
    name: str
    item_group_id: int
    item_group_name: str
    default_unit_id: int
    default_unit_name: str
    smallest_unit_id: int
    smallest_unit_name: str
    note: str | None
    is_active: bool
    is_stock_tracked: bool
    conversions: list[ItemUnitConversionOutput]


class StockTrackingInput(BaseModel):
    is_stock_tracked: bool


def clean_name(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip())


def clean_optional(value: str | None) -> str | None:
    if value is None:
        return None

    cleaned = unicodedata.normalize("NFC", value.strip())
    return cleaned or None


def name_key(value: str) -> str:
    return clean_name(value).casefold()


def ensure_name_is_unique(
    connection: sqlite3.Connection,
    name: str,
    exclude_id: int | None = None,
) -> None:
    requested_key = name_key(name)
    rows = connection.execute("SELECT id, name FROM items").fetchall()

    for row in rows:
        if exclude_id is not None and row["id"] == exclude_id:
            continue

        if name_key(row["name"]) == requested_key:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên hàng hóa đã tồn tại.",
            )


def ensure_master_data_exists(
    connection: sqlite3.Connection,
    *,
    item_group_id: int,
    unit_ids: set[int],
) -> None:
    group = connection.execute(
        "SELECT id FROM item_groups WHERE id = ?",
        (item_group_id,),
    ).fetchone()

    if group is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nhóm hàng hóa không tồn tại.",
        )

    if not unit_ids:
        return

    placeholders = ",".join("?" for _ in unit_ids)
    rows = connection.execute(
        f"SELECT id FROM units WHERE id IN ({placeholders})",
        tuple(unit_ids),
    ).fetchall()

    found = {row["id"] for row in rows}
    if found != unit_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Có đơn vị tính không tồn tại.",
        )


def normalize_conversions(payload: ItemInput) -> list[ItemUnitConversionInput]:
    conversions = list(payload.conversions)
    seen: set[int] = set()

    for conversion in conversions:
        if conversion.unit_id in seen:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Một đơn vị chỉ được khai báo một lần trong quy đổi.",
            )
        seen.add(conversion.unit_id)

    smallest = next(
        (
            conversion
            for conversion in conversions
            if conversion.unit_id == payload.smallest_unit_id
        ),
        None,
    )

    if smallest is None:
        smallest = ItemUnitConversionInput(
            unit_id=payload.smallest_unit_id,
            quantity_in_smallest_unit=1,
            is_active=True,
        )
        conversions.append(smallest)
    elif (
        abs(smallest.quantity_in_smallest_unit - 1) > 1e-9
        or not smallest.is_active
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Đơn vị nhỏ nhất phải có hệ số quy đổi bằng 1 và đang sử dụng.",
        )

    default_conversion = next(
        (
            conversion
            for conversion in conversions
            if conversion.unit_id == payload.default_unit_id
        ),
        None,
    )

    if default_conversion is None:
        if payload.default_unit_id == payload.smallest_unit_id:
            default_conversion = smallest
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Cần khai báo hệ số quy đổi cho đơn vị mặc định.",
            )

    if not default_conversion.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Đơn vị mặc định phải ở trạng thái đang sử dụng.",
        )

    return conversions


def replace_conversions(
    connection: sqlite3.Connection,
    *,
    item_id: int,
    conversions: list[ItemUnitConversionInput],
) -> None:
    connection.execute(
        "DELETE FROM item_unit_conversions WHERE item_id = ?",
        (item_id,),
    )

    for conversion in conversions:
        connection.execute(
            """
            INSERT INTO item_unit_conversions (
                item_id,
                unit_id,
                quantity_in_smallest_unit,
                is_active
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                item_id,
                conversion.unit_id,
                conversion.quantity_in_smallest_unit,
                int(conversion.is_active),
            ),
        )


def select_item(connection: sqlite3.Connection, item_id: int) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            i.id,
            i.name,
            i.item_group_id,
            g.name AS item_group_name,
            i.default_unit_id,
            du.name AS default_unit_name,
            i.smallest_unit_id,
            su.name AS smallest_unit_name,
            i.note,
            i.is_active,
            i.is_stock_tracked
        FROM items AS i
        JOIN item_groups AS g ON g.id = i.item_group_id
        JOIN units AS du ON du.id = i.default_unit_id
        JOIN units AS su ON su.id = i.smallest_unit_id
        WHERE i.id = ?
        """,
        (item_id,),
    ).fetchone()


def select_conversions(
    connection: sqlite3.Connection,
    item_id: int,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT
            c.id,
            c.unit_id,
            u.name AS unit_name,
            c.quantity_in_smallest_unit,
            c.is_active
        FROM item_unit_conversions AS c
        JOIN units AS u ON u.id = c.unit_id
        WHERE c.item_id = ?
        ORDER BY c.quantity_in_smallest_unit DESC, u.name ASC
        """,
        (item_id,),
    ).fetchall()


def row_to_output(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
) -> ItemOutput:
    conversions = [
        ItemUnitConversionOutput(
            id=conversion["id"],
            unit_id=conversion["unit_id"],
            unit_name=conversion["unit_name"],
            quantity_in_smallest_unit=conversion["quantity_in_smallest_unit"],
            is_active=bool(conversion["is_active"]),
        )
        for conversion in select_conversions(connection, row["id"])
    ]

    return ItemOutput(
        id=row["id"],
        name=row["name"],
        item_group_id=row["item_group_id"],
        item_group_name=row["item_group_name"],
        default_unit_id=row["default_unit_id"],
        default_unit_name=row["default_unit_name"],
        smallest_unit_id=row["smallest_unit_id"],
        smallest_unit_name=row["smallest_unit_name"],
        note=row["note"],
        is_active=bool(row["is_active"]),
        is_stock_tracked=bool(row["is_stock_tracked"]),
        conversions=conversions,
    )


@router.get("", response_model=list[ItemOutput])
def list_items() -> list[ItemOutput]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT
                i.id,
                i.name,
                i.item_group_id,
                g.name AS item_group_name,
                i.default_unit_id,
                du.name AS default_unit_name,
                i.smallest_unit_id,
                su.name AS smallest_unit_name,
                i.note,
                i.is_active,
                i.is_stock_tracked
            FROM items AS i
            JOIN item_groups AS g ON g.id = i.item_group_id
            JOIN units AS du ON du.id = i.default_unit_id
            JOIN units AS su ON su.id = i.smallest_unit_id
            ORDER BY i.is_active DESC, i.name ASC
            """
        ).fetchall()

        return [row_to_output(connection, row) for row in rows]


@router.post(
    "",
    response_model=ItemOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_item(payload: ItemInput) -> ItemOutput:
    cleaned_name = clean_name(payload.name)

    if not cleaned_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên hàng hóa không được để trống.",
        )

    conversions = normalize_conversions(payload)
    unit_ids = {payload.default_unit_id, payload.smallest_unit_id}
    unit_ids.update(conversion.unit_id for conversion in conversions)

    with connect() as connection:
        ensure_name_is_unique(connection, cleaned_name)
        ensure_master_data_exists(
            connection,
            item_group_id=payload.item_group_id,
            unit_ids=unit_ids,
        )

        cursor = connection.execute(
            """
            INSERT INTO items (
                name,
                item_group_id,
                default_unit_id,
                smallest_unit_id,
                note,
                is_active,
                is_stock_tracked
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cleaned_name,
                payload.item_group_id,
                payload.default_unit_id,
                payload.smallest_unit_id,
                clean_optional(payload.note),
                int(payload.is_active),
                int(payload.is_stock_tracked if payload.is_stock_tracked is not None else True),
            ),
        )

        replace_conversions(
            connection,
            item_id=cursor.lastrowid,
            conversions=conversions,
        )
        connection.commit()

        row = select_item(connection, cursor.lastrowid)
        output = row_to_output(connection, row)

    backup_database(reason="item-created")
    return output


@router.put("/{item_id}", response_model=ItemOutput)
def update_item(item_id: int, payload: ItemInput) -> ItemOutput:
    cleaned_name = clean_name(payload.name)

    if not cleaned_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên hàng hóa không được để trống.",
        )

    conversions = normalize_conversions(payload)
    unit_ids = {payload.default_unit_id, payload.smallest_unit_id}
    unit_ids.update(conversion.unit_id for conversion in conversions)

    with connect() as connection:
        existing = connection.execute(
            "SELECT id, smallest_unit_id, is_stock_tracked FROM items WHERE id = ?",
            (item_id,),
        ).fetchone()

        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy hàng hóa.",
            )

        ensure_name_is_unique(connection, cleaned_name, exclude_id=item_id)
        ensure_master_data_exists(
            connection,
            item_group_id=payload.item_group_id,
            unit_ids=unit_ids,
        )

        if payload.smallest_unit_id != existing["smallest_unit_id"]:
            has_inventory_history = connection.execute(
                """
                SELECT 1
                FROM inventory_movements
                WHERE item_id = ?
                LIMIT 1
                """,
                (item_id,),
            ).fetchone()
            if has_inventory_history is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Không thể đổi đơn vị nhỏ nhất vì hàng hóa đã có "
                        "phát sinh tồn kho."
                    ),
                )

        connection.execute(
            """
            UPDATE items
            SET
                name = ?,
                item_group_id = ?,
                default_unit_id = ?,
                smallest_unit_id = ?,
                note = ?,
                is_active = ?,
                is_stock_tracked = ?
            WHERE id = ?
            """,
            (
                cleaned_name,
                payload.item_group_id,
                payload.default_unit_id,
                payload.smallest_unit_id,
                clean_optional(payload.note),
                int(payload.is_active),
                int(existing["is_stock_tracked"]) if payload.is_stock_tracked is None
                else int(payload.is_stock_tracked),
                item_id,
            ),
        )

        replace_conversions(
            connection,
            item_id=item_id,
            conversions=conversions,
        )
        connection.commit()

        row = select_item(connection, item_id)
        output = row_to_output(connection, row)

    backup_database(reason="item-updated")
    return output


@router.patch("/{item_id}/stock-tracking", response_model=ItemOutput)
def set_item_stock_tracking(
    item_id: int,
    payload: StockTrackingInput,
) -> ItemOutput:
    # Changing monitoring never removes movements or disables purchases/sales.
    with connect() as connection:
        current = select_item(connection, item_id)
        if current is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy hàng hóa.",
            )
        connection.execute(
            "UPDATE items SET is_stock_tracked = ? WHERE id = ?",
            (int(payload.is_stock_tracked), item_id),
        )
        connection.commit()
        output = row_to_output(connection, select_item(connection, item_id))

    backup_database(reason="item-stock-tracking-updated")
    return output
