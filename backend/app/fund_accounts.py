import sqlite3
import unicodedata

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/fund-accounts", tags=["fund-accounts"])


class FundAccountInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str
    bank_name: str | None = Field(default=None, max_length=100)
    account_number: str | None = Field(default=None, max_length=100)
    account_name: str | None = Field(default=None, max_length=150)
    note: str | None = Field(default=None, max_length=500)
    is_active: bool = True


class FundAccountOutput(FundAccountInput):
    id: int
    current_balance: int
    can_delete: bool


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = unicodedata.normalize("NFC", value.strip())
    return cleaned or None


def clean_name(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip())


def normalize_type(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in {"CASH", "BANK"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loại quỹ không hợp lệ.",
        )
    return normalized


def ensure_name_unique(
    connection: sqlite3.Connection,
    name: str,
    account_type: str,
    exclude_id: int | None = None,
) -> None:
    rows = connection.execute(
        """
        SELECT id, name
        FROM fund_accounts
        WHERE type = ?
        """,
        (account_type,),
    ).fetchall()
    requested = clean_name(name).casefold()
    for row in rows:
        if exclude_id is not None and row["id"] == exclude_id:
            continue
        if clean_name(row["name"]).casefold() == requested:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên quỹ/tài khoản đã tồn tại.",
            )


def has_transactions(connection: sqlite3.Connection, account_id: int) -> bool:
    row = connection.execute(
        """
        SELECT 1
        FROM fund_transactions
        WHERE fund_account_id = ?
        LIMIT 1
        """,
        (account_id,),
    ).fetchone()
    return row is not None


def row_to_output(row: sqlite3.Row, *, can_delete: bool) -> FundAccountOutput:
    return FundAccountOutput(
        id=row["id"],
        name=row["name"],
        type=row["type"],
        bank_name=row["bank_name"],
        account_number=row["account_number"],
        account_name=row["account_name"],
        note=row["note"],
        is_active=bool(row["is_active"]),
        current_balance=row["current_balance"],
        can_delete=can_delete,
    )


@router.get("", response_model=list[FundAccountOutput])
def list_fund_accounts(
    type: str | None = Query(default=None),
) -> list[FundAccountOutput]:
    with connect() as connection:
        params: tuple = ()
        where = ""
        if type:
            account_type = normalize_type(type)
            where = "WHERE type = ?"
            params = (account_type,)

        rows = connection.execute(
            f"""
            SELECT
                id,
                name,
                type,
                bank_name,
                account_number,
                account_name,
                note,
                is_active,
                current_balance
            FROM fund_accounts
            {where}
            ORDER BY is_active DESC, name COLLATE NOCASE ASC, id ASC
            """,
            params,
        ).fetchall()

        return [
            row_to_output(
                row,
                can_delete=not has_transactions(connection, row["id"]),
            )
            for row in rows
        ]


@router.post(
    "",
    response_model=FundAccountOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_fund_account(payload: FundAccountInput) -> FundAccountOutput:
    name = clean_name(payload.name)
    account_type = normalize_type(payload.type)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên quỹ/tài khoản không được để trống.",
        )

    with connect() as connection:
        ensure_name_unique(connection, name, account_type)

        cursor = connection.execute(
            """
            INSERT INTO fund_accounts (
                name,
                type,
                bank_name,
                account_number,
                account_name,
                current_balance,
                is_active,
                note
            )
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                name,
                account_type,
                clean_text(payload.bank_name),
                clean_text(payload.account_number),
                clean_text(payload.account_name),
                int(payload.is_active),
                clean_text(payload.note),
            ),
        )
        connection.commit()

        row = connection.execute(
            """
            SELECT
                id,
                name,
                type,
                bank_name,
                account_number,
                account_name,
                note,
                is_active,
                current_balance
            FROM fund_accounts
            WHERE id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()

    backup_database(reason="fund-account-created")
    return row_to_output(row, can_delete=True)


@router.put("/{account_id}", response_model=FundAccountOutput)
def update_fund_account(
    account_id: int,
    payload: FundAccountInput,
) -> FundAccountOutput:
    name = clean_name(payload.name)
    account_type = normalize_type(payload.type)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên quỹ/tài khoản không được để trống.",
        )

    with connect() as connection:
        existing = connection.execute(
            "SELECT id, type FROM fund_accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy quỹ/tài khoản.",
            )

        if has_transactions(connection, account_id) and existing["type"] != account_type:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Quỹ đã có giao dịch nên không thể đổi loại.",
            )

        ensure_name_unique(
            connection,
            name,
            account_type,
            exclude_id=account_id,
        )

        connection.execute(
            """
            UPDATE fund_accounts
            SET
                name = ?,
                type = ?,
                bank_name = ?,
                account_number = ?,
                account_name = ?,
                is_active = ?,
                note = ?
            WHERE id = ?
            """,
            (
                name,
                account_type,
                clean_text(payload.bank_name),
                clean_text(payload.account_number),
                clean_text(payload.account_name),
                int(payload.is_active),
                clean_text(payload.note),
                account_id,
            ),
        )
        connection.commit()

        row = connection.execute(
            """
            SELECT
                id,
                name,
                type,
                bank_name,
                account_number,
                account_name,
                note,
                is_active,
                current_balance
            FROM fund_accounts
            WHERE id = ?
            """,
            (account_id,),
        ).fetchone()

        can_delete = not has_transactions(connection, account_id)

    backup_database(reason="fund-account-updated")
    return row_to_output(row, can_delete=can_delete)


@router.delete("/{account_id}")
def delete_fund_account(account_id: int) -> dict[str, bool]:
    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM fund_accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy quỹ/tài khoản.",
            )

        if has_transactions(connection, account_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Quỹ/tài khoản đã có giao dịch nên không thể xóa.",
            )

        connection.execute(
            "DELETE FROM fund_accounts WHERE id = ?",
            (account_id,),
        )
        connection.commit()

    backup_database(reason="fund-account-deleted")
    return {"deleted": True}
