import sqlite3
import unicodedata

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/units", tags=["units"])


class UnitInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    is_active: bool = True


class UnitOutput(UnitInput):
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
    rows = connection.execute("SELECT id, name FROM units").fetchall()

    for row in rows:
        if exclude_id is not None and row["id"] == exclude_id:
            continue

        if name_key(row["name"]) == requested_key:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên đơn vị tính đã tồn tại.",
            )


def row_to_output(row: sqlite3.Row) -> UnitOutput:
    return UnitOutput(
        id=row["id"],
        name=row["name"],
        is_active=bool(row["is_active"]),
    )


@router.get("", response_model=list[UnitOutput])
def list_units() -> list[UnitOutput]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, name, is_active
            FROM units
            ORDER BY is_active DESC, name ASC
            """
        ).fetchall()

    return [row_to_output(row) for row in rows]


@router.post(
    "",
    response_model=UnitOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_unit(payload: UnitInput) -> UnitOutput:
    cleaned_name = clean_name(payload.name)

    if not cleaned_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên đơn vị tính không được để trống.",
        )

    with connect() as connection:
        ensure_name_is_unique(connection, cleaned_name)

        try:
            cursor = connection.execute(
                """
                INSERT INTO units (name, is_active)
                VALUES (?, ?)
                """,
                (cleaned_name, int(payload.is_active)),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên đơn vị tính đã tồn tại.",
            ) from exc

        row = connection.execute(
            """
            SELECT id, name, is_active
            FROM units
            WHERE id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()

    backup_database(reason="unit-created")
    return row_to_output(row)


@router.put("/{unit_id}", response_model=UnitOutput)
def update_unit(unit_id: int, payload: UnitInput) -> UnitOutput:
    cleaned_name = clean_name(payload.name)

    if not cleaned_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên đơn vị tính không được để trống.",
        )

    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM units WHERE id = ?",
            (unit_id,),
        ).fetchone()

        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy đơn vị tính.",
            )

        ensure_name_is_unique(connection, cleaned_name, exclude_id=unit_id)

        try:
            connection.execute(
                """
                UPDATE units
                SET name = ?, is_active = ?
                WHERE id = ?
                """,
                (cleaned_name, int(payload.is_active), unit_id),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên đơn vị tính đã tồn tại.",
            ) from exc

        row = connection.execute(
            """
            SELECT id, name, is_active
            FROM units
            WHERE id = ?
            """,
            (unit_id,),
        ).fetchone()

    backup_database(reason="unit-updated")
    return row_to_output(row)
