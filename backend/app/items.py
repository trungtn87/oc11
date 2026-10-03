import sqlite3
import unicodedata
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/items", tags=["items"])

ItemType = Literal["material", "direct_sale"]


class ItemInput(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    item_type: ItemType
    item_group_id: int
    unit_id: int
    note: str | None = Field(default=None, max_length=500)
    is_active: bool = True


class ItemOutput(ItemInput):
    id: int
    item_group_name: str
    unit_name: str


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
    unit_id: int,
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

    unit = connection.execute(
        "SELECT id FROM units WHERE id = ?",
        (unit_id,),
    ).fetchone()

    if unit is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Đơn vị tính không tồn tại.",
        )


def select_item(connection: sqlite3.Connection, item_id: int) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            i.id,
            i.name,
            i.item_type,
            i.item_group_id,
            g.name AS item_group_name,
            i.unit_id,
            u.name AS unit_name,
            i.note,
            i.is_active
        FROM items AS i
        JOIN item_groups AS g ON g.id = i.item_group_id
        JOIN units AS u ON u.id = i.unit_id
        WHERE i.id = ?
        """,
        (item_id,),
    ).fetchone()


def row_to_output(row: sqlite3.Row) -> ItemOutput:
    return ItemOutput(
        id=row["id"],
        name=row["name"],
        item_type=row["item_type"],
        item_group_id=row["item_group_id"],
        item_group_name=row["item_group_name"],
        unit_id=row["unit_id"],
        unit_name=row["unit_name"],
        note=row["note"],
        is_active=bool(row["is_active"]),
    )


@router.get("", response_model=list[ItemOutput])
def list_items() -> list[ItemOutput]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT
                i.id,
                i.name,
                i.item_type,
                i.item_group_id,
                g.name AS item_group_name,
                i.unit_id,
                u.name AS unit_name,
                i.note,
                i.is_active
            FROM items AS i
            JOIN item_groups AS g ON g.id = i.item_group_id
            JOIN units AS u ON u.id = i.unit_id
            ORDER BY i.is_active DESC, i.name ASC
            """
        ).fetchall()

    return [row_to_output(row) for row in rows]


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

    with connect() as connection:
        ensure_name_is_unique(connection, cleaned_name)
        ensure_master_data_exists(
            connection,
            item_group_id=payload.item_group_id,
            unit_id=payload.unit_id,
        )

        cursor = connection.execute(
            """
            INSERT INTO items (
                name,
                item_type,
                item_group_id,
                unit_id,
                note,
                is_active
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                cleaned_name,
                payload.item_type,
                payload.item_group_id,
                payload.unit_id,
                clean_optional(payload.note),
                int(payload.is_active),
            ),
        )
        connection.commit()

        row = select_item(connection, cursor.lastrowid)

    backup_database(reason="item-created")
    return row_to_output(row)


@router.put("/{item_id}", response_model=ItemOutput)
def update_item(item_id: int, payload: ItemInput) -> ItemOutput:
    cleaned_name = clean_name(payload.name)

    if not cleaned_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên hàng hóa không được để trống.",
        )

    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM items WHERE id = ?",
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
            unit_id=payload.unit_id,
        )

        connection.execute(
            """
            UPDATE items
            SET
                name = ?,
                item_type = ?,
                item_group_id = ?,
                unit_id = ?,
                note = ?,
                is_active = ?
            WHERE id = ?
            """,
            (
                cleaned_name,
                payload.item_type,
                payload.item_group_id,
                payload.unit_id,
                clean_optional(payload.note),
                int(payload.is_active),
                item_id,
            ),
        )
        connection.commit()

        row = select_item(connection, item_id)

    backup_database(reason="item-updated")
    return row_to_output(row)
