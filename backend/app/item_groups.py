import sqlite3
import unicodedata

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/item-groups", tags=["item-groups"])


class ItemGroupInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=500)
    is_active: bool = True


class ItemGroupOutput(ItemGroupInput):
    id: int


def clean_name(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip())


def name_key(value: str) -> str:
    return clean_name(value).casefold()


def ensure_name_is_unique(
    connection: sqlite3.Connection,
    name: str,
    exclude_id: int | None = None,
) -> None:
    requested_key = name_key(name)
    rows = connection.execute("SELECT id, name FROM item_groups").fetchall()

    for row in rows:
        if exclude_id is not None and row["id"] == exclude_id:
            continue

        if name_key(row["name"]) == requested_key:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên nhóm hàng hóa đã tồn tại.",
            )


def row_to_output(row: sqlite3.Row) -> ItemGroupOutput:
    return ItemGroupOutput(
        id=row["id"],
        name=row["name"],
        note=row["note"],
        is_active=bool(row["is_active"]),
    )


@router.get("", response_model=list[ItemGroupOutput])
def list_item_groups() -> list[ItemGroupOutput]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, name, note, is_active
            FROM item_groups
            ORDER BY is_active DESC, name ASC
            """
        ).fetchall()

    return [row_to_output(row) for row in rows]


@router.post(
    "",
    response_model=ItemGroupOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_item_group(payload: ItemGroupInput) -> ItemGroupOutput:
    cleaned_name = clean_name(payload.name)

    if not cleaned_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên nhóm hàng hóa không được để trống.",
        )

    with connect() as connection:
        ensure_name_is_unique(connection, cleaned_name)

        try:
            cursor = connection.execute(
                """
                INSERT INTO item_groups (name, note, is_active)
                VALUES (?, ?, ?)
                """,
                (cleaned_name, payload.note, int(payload.is_active)),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên nhóm hàng hóa đã tồn tại.",
            ) from exc

        row = connection.execute(
            """
            SELECT id, name, note, is_active
            FROM item_groups
            WHERE id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()

    backup_database(reason="item-group-created")
    return row_to_output(row)


@router.put("/{group_id}", response_model=ItemGroupOutput)
def update_item_group(group_id: int, payload: ItemGroupInput) -> ItemGroupOutput:
    cleaned_name = clean_name(payload.name)

    if not cleaned_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên nhóm hàng hóa không được để trống.",
        )

    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM item_groups WHERE id = ?",
            (group_id,),
        ).fetchone()

        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy nhóm hàng hóa.",
            )

        ensure_name_is_unique(connection, cleaned_name, exclude_id=group_id)

        try:
            connection.execute(
                """
                UPDATE item_groups
                SET name = ?, note = ?, is_active = ?
                WHERE id = ?
                """,
                (cleaned_name, payload.note, int(payload.is_active), group_id),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên nhóm hàng hóa đã tồn tại.",
            ) from exc

        row = connection.execute(
            """
            SELECT id, name, note, is_active
            FROM item_groups
            WHERE id = ?
            """,
            (group_id,),
        ).fetchone()

    backup_database(reason="item-group-updated")
    return row_to_output(row)
