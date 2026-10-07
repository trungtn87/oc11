import sqlite3

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/sales/surcharges", tags=["sales-surcharges"])


class SurchargePresetInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    amount: int = Field(gt=0)


class SurchargePresetOutput(SurchargePresetInput):
    id: int


def clean_name(value: str) -> str:
    return value.strip()


def row_to_output(row: sqlite3.Row) -> SurchargePresetOutput:
    return SurchargePresetOutput(
        id=int(row["id"]),
        name=row["name"],
        amount=int(row["amount"]),
    )


@router.get("", response_model=list[SurchargePresetOutput])
def list_surcharge_presets() -> list[SurchargePresetOutput]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, name, amount
            FROM sale_surcharge_presets
            ORDER BY name COLLATE NOCASE, id
            """
        ).fetchall()
    return [row_to_output(row) for row in rows]


@router.post(
    "",
    response_model=SurchargePresetOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_surcharge_preset(
    payload: SurchargePresetInput,
) -> SurchargePresetOutput:
    name = clean_name(payload.name)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên phụ thu không được để trống.",
        )

    with connect() as connection:
        existing = connection.execute(
            """
            SELECT id, name, amount
            FROM sale_surcharge_presets
            WHERE name = ? COLLATE NOCASE
            """,
            (name,),
        ).fetchone()
        if existing is not None:
            return row_to_output(existing)

        try:
            cursor = connection.execute(
                """
                INSERT INTO sale_surcharge_presets (name, amount, created_at, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                (name, int(payload.amount)),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên phụ thu đã tồn tại.",
            ) from exc

        row = connection.execute(
            """
            SELECT id, name, amount
            FROM sale_surcharge_presets
            WHERE id = ?
            """,
            (int(cursor.lastrowid),),
        ).fetchone()

    backup_database(reason="sale-surcharge-created")
    assert row is not None
    return row_to_output(row)


@router.put("/{preset_id}", response_model=SurchargePresetOutput)
def update_surcharge_preset(
    preset_id: int,
    payload: SurchargePresetInput,
) -> SurchargePresetOutput:
    name = clean_name(payload.name)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên phụ thu không được để trống.",
        )

    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM sale_surcharge_presets WHERE id = ?",
            (preset_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy phụ thu.",
            )

        duplicate = connection.execute(
            """
            SELECT id
            FROM sale_surcharge_presets
            WHERE name = ? COLLATE NOCASE
              AND id <> ?
            """,
            (name, preset_id),
        ).fetchone()
        if duplicate is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên phụ thu đã tồn tại.",
            )

        connection.execute(
            """
            UPDATE sale_surcharge_presets
            SET name = ?, amount = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (name, int(payload.amount), preset_id),
        )
        connection.commit()
        row = connection.execute(
            """
            SELECT id, name, amount
            FROM sale_surcharge_presets
            WHERE id = ?
            """,
            (preset_id,),
        ).fetchone()

    backup_database(reason="sale-surcharge-updated")
    assert row is not None
    return row_to_output(row)


@router.delete("/{preset_id}")
def delete_surcharge_preset(preset_id: int) -> dict[str, bool]:
    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM sale_surcharge_presets WHERE id = ?",
            (preset_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy phụ thu.",
            )

        connection.execute(
            "DELETE FROM sale_surcharge_presets WHERE id = ?",
            (preset_id,),
        )
        connection.commit()

    backup_database(reason="sale-surcharge-deleted")
    return {"deleted": True}
