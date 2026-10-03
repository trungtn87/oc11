import sqlite3
import unicodedata

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


class SupplierInput(BaseModel):
    name: str = Field(min_length=1)
    phone: str | None = None
    address: str | None = None
    note: str | None = None
    bank_name: str | None = None
    bank_account_number: str | None = None
    bank_account_name: str | None = None
    payment_qr_image: str | None = None


class SupplierOutput(SupplierInput):
    id: int
    can_delete: bool


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None

    cleaned = unicodedata.normalize("NFC", value.strip())
    return cleaned or None


def clean_name(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip())


def _quoted_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def has_supplier_links(connection: sqlite3.Connection, supplier_id: int) -> bool:
    tables = connection.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name <> 'suppliers'
        """
    ).fetchall()

    for table_row in tables:
        table_name = table_row["name"]
        quoted_table = _quoted_identifier(table_name)
        columns = connection.execute(
            f"PRAGMA table_info({quoted_table})"
        ).fetchall()

        if not any(column["name"] == "supplier_id" for column in columns):
            continue

        linked = connection.execute(
            f"SELECT 1 FROM {quoted_table} WHERE supplier_id = ? LIMIT 1",
            (supplier_id,),
        ).fetchone()

        if linked is not None:
            return True

    return False


def row_to_output(
    row: sqlite3.Row,
    *,
    can_delete: bool,
) -> SupplierOutput:
    return SupplierOutput(
        id=row["id"],
        name=row["name"],
        phone=row["phone"],
        address=row["address"],
        note=row["note"],
        bank_name=row["bank_name"],
        bank_account_number=row["bank_account_number"],
        bank_account_name=row["bank_account_name"],
        payment_qr_image=row["payment_qr_image"],
        can_delete=can_delete,
    )


def cleaned_payload(payload: SupplierInput) -> tuple:
    return (
        clean_name(payload.name),
        clean_text(payload.phone),
        clean_text(payload.address),
        clean_text(payload.note),
        clean_text(payload.bank_name),
        clean_text(payload.bank_account_number),
        clean_text(payload.bank_account_name),
        payload.payment_qr_image,
    )


@router.get("", response_model=list[SupplierOutput])
def list_suppliers() -> list[SupplierOutput]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                name,
                phone,
                address,
                note,
                bank_name,
                bank_account_number,
                bank_account_name,
                payment_qr_image
            FROM suppliers
            ORDER BY name COLLATE NOCASE ASC, id ASC
            """
        ).fetchall()

        return [
            row_to_output(
                row,
                can_delete=not has_supplier_links(connection, row["id"]),
            )
            for row in rows
        ]


@router.post(
    "",
    response_model=SupplierOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_supplier(payload: SupplierInput) -> SupplierOutput:
    values = cleaned_payload(payload)

    if not values[0]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên nhà cung cấp không được để trống.",
        )

    with connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO suppliers (
                name,
                phone,
                address,
                note,
                bank_name,
                bank_account_number,
                bank_account_name,
                payment_qr_image
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values,
        )
        connection.commit()

        row = connection.execute(
            """
            SELECT
                id,
                name,
                phone,
                address,
                note,
                bank_name,
                bank_account_number,
                bank_account_name,
                payment_qr_image
            FROM suppliers
            WHERE id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()

    backup_database(reason="supplier-created")
    return row_to_output(row, can_delete=True)


@router.put("/{supplier_id}", response_model=SupplierOutput)
def update_supplier(
    supplier_id: int,
    payload: SupplierInput,
) -> SupplierOutput:
    values = cleaned_payload(payload)

    if not values[0]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên nhà cung cấp không được để trống.",
        )

    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM suppliers WHERE id = ?",
            (supplier_id,),
        ).fetchone()

        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy nhà cung cấp.",
            )

        connection.execute(
            """
            UPDATE suppliers
            SET
                name = ?,
                phone = ?,
                address = ?,
                note = ?,
                bank_name = ?,
                bank_account_number = ?,
                bank_account_name = ?,
                payment_qr_image = ?
            WHERE id = ?
            """,
            (*values, supplier_id),
        )
        connection.commit()

        row = connection.execute(
            """
            SELECT
                id,
                name,
                phone,
                address,
                note,
                bank_name,
                bank_account_number,
                bank_account_name,
                payment_qr_image
            FROM suppliers
            WHERE id = ?
            """,
            (supplier_id,),
        ).fetchone()

        can_delete = not has_supplier_links(connection, supplier_id)

    backup_database(reason="supplier-updated")
    return row_to_output(row, can_delete=can_delete)


@router.delete("/{supplier_id}")
def delete_supplier(supplier_id: int) -> dict[str, bool]:
    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM suppliers WHERE id = ?",
            (supplier_id,),
        ).fetchone()

        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy nhà cung cấp.",
            )

        if has_supplier_links(connection, supplier_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Nhà cung cấp đã có dữ liệu nghiệp vụ liên kết "
                    "nên không thể xóa."
                ),
            )

        connection.execute(
            "DELETE FROM suppliers WHERE id = ?",
            (supplier_id,),
        )
        connection.commit()

    backup_database(reason="supplier-deleted")
    return {"deleted": True}
