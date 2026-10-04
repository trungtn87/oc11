import sqlite3
import uuid
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/fund-transactions", tags=["fund-transactions"])


TRANSACTION_TYPES = {
    "NORMAL",
    "TRANSFER",
    "BALANCE_ADJUSTMENT",
    "OPENING_BALANCE",
}


class FundTransactionOutput(BaseModel):
    id: int
    fund_account_id: int
    fund_account_name: str
    account_type: str
    transaction_time: str
    transaction_type: str
    category_id: int | None
    category_name: str | None
    direction: str
    amount: int
    reference_code: str | None
    description: str | None
    note: str | None
    running_balance: int


class FundTransactionListOutput(BaseModel):
    opening_balance: int
    total_in: int
    total_out: int
    closing_balance: int
    items: list[FundTransactionOutput]


class FundTransactionCreateInput(BaseModel):
    account_type: str
    fund_account_id: int
    direction: str
    transaction_type: str
    transaction_time: str
    category_id: int | None = None
    amount: int | None = Field(default=None, ge=1)
    actual_balance: int | None = Field(default=None, ge=0)
    related_fund_account_id: int | None = None
    description: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1000)
    source_type: str | None = Field(default=None, max_length=60)
    source_id: str | None = Field(default=None, max_length=80)


class FundTransactionCreateOutput(BaseModel):
    created_ids: list[int]
    reference_codes: list[str]


def normalize_account_type(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in {"CASH", "BANK"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loại sổ tiền không hợp lệ.",
        )
    return normalized


def normalize_direction(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in {"IN", "OUT"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loại phiếu không hợp lệ.",
        )
    return normalized


def normalize_transaction_type(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in TRANSACTION_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loại giao dịch không hợp lệ.",
        )
    return normalized


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def get_account(connection: sqlite3.Connection, account_id: int) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT id, name, type, current_balance, is_active
        FROM fund_accounts
        WHERE id = ?
        """,
        (account_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy quỹ/tài khoản.",
        )
    return row


def get_category(
    connection: sqlite3.Connection,
    category_id: int,
    direction: str,
) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT id, name, direction, is_active
        FROM fund_transaction_categories
        WHERE id = ?
        """,
        (category_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy loại thu/chi.",
        )
    if not bool(row["is_active"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Loại thu/chi đang ngừng sử dụng.",
        )
    if row["direction"] != direction:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loại thu/chi không đúng với phiếu đang tạo.",
        )
    return row


def next_reference_code(
    connection: sqlite3.Connection,
    direction: str,
    transaction_time: str,
) -> str:
    try:
        dt = datetime.fromisoformat(transaction_time)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày chứng từ không hợp lệ.",
        )

    prefix = "PT" if direction == "IN" else "PC"
    day_key = dt.strftime("%Y%m%d")
    pattern = f"{prefix}-{day_key}-%"

    row = connection.execute(
        """
        SELECT COUNT(*) AS total
        FROM fund_transactions
        WHERE reference_code LIKE ?
        """,
        (pattern,),
    ).fetchone()
    sequence = int(row["total"]) + 1
    return f"{prefix}-{day_key}-{sequence:03d}"


def insert_transaction(
    connection: sqlite3.Connection,
    *,
    fund_account_id: int,
    transaction_time: str,
    transaction_type: str,
    category_id: int | None,
    direction: str,
    amount: int,
    reference_code: str,
    group_id: str | None,
    description: str | None,
    note: str | None,
    source_type: str | None = None,
    source_id: str | None = None,
) -> int:
    cursor = connection.execute(
        """
        INSERT INTO fund_transactions (
            fund_account_id,
            transaction_time,
            transaction_type,
            category_id,
            direction,
            amount,
            reference_code,
            group_id,
            source_type,
            source_id,
            description,
            note,
            created_at,
            is_void
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
        """,
        (
            fund_account_id,
            transaction_time,
            transaction_type,
            category_id,
            direction,
            amount,
            reference_code,
            group_id,
            source_type,
            source_id,
            description,
            note,
        ),
    )

    if (
        direction == "OUT"
        and source_type == "PURCHASE_RECEIPT"
        and source_id is not None
    ):
        connection.execute(
            """
            UPDATE purchase_receipts
            SET payment_status = 'PAID',
                payment_reference_code = ?
            WHERE id = ?
              AND payment_status = 'DEBT'
            """,
            (reference_code, source_id),
        )

    delta = amount if direction == "IN" else -amount
    connection.execute(
        """
        UPDATE fund_accounts
        SET current_balance = current_balance + ?
        WHERE id = ?
        """,
        (delta, fund_account_id),
    )

    return int(cursor.lastrowid)


@router.post(
    "",
    response_model=FundTransactionCreateOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_fund_transaction(
    payload: FundTransactionCreateInput,
) -> FundTransactionCreateOutput:
    account_type = normalize_account_type(payload.account_type)
    direction = normalize_direction(payload.direction)
    transaction_type = normalize_transaction_type(payload.transaction_type)
    description = clean_text(payload.description)
    note = clean_text(payload.note)

    created_ids: list[int] = []
    reference_codes: list[str] = []

    with connect() as connection:
        account = get_account(connection, payload.fund_account_id)

        if account["type"] != account_type:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Quỹ/tài khoản không đúng loại sổ tiền.",
            )

        if not bool(account["is_active"]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Quỹ/tài khoản đang ngừng sử dụng.",
            )

        if transaction_type == "OPENING_BALANCE":
            if direction != "IN":
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Số dư đầu kỳ chỉ được tạo bằng phiếu thu.",
                )
            if payload.amount is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Nhập số dư đầu kỳ.",
                )

            existing = connection.execute(
                """
                SELECT 1
                FROM fund_transactions
                WHERE fund_account_id = ?
                  AND transaction_type = 'OPENING_BALANCE'
                  AND is_void = 0
                LIMIT 1
                """,
                (payload.fund_account_id,),
            ).fetchone()
            if existing is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Quỹ/tài khoản đã có số dư đầu kỳ.",
                )

            reference = next_reference_code(
                connection,
                direction,
                payload.transaction_time,
            )
            created_ids.append(
                insert_transaction(
                    connection,
                    fund_account_id=payload.fund_account_id,
                    transaction_time=payload.transaction_time,
                    transaction_type=transaction_type,
                    category_id=None,
                    direction=direction,
                    amount=payload.amount,
                    reference_code=reference,
                    group_id=None,
                    description=description or "Số dư đầu kỳ",
                    note=note,
                )
            )
            reference_codes.append(reference)

        elif transaction_type == "BALANCE_ADJUSTMENT":
            if payload.actual_balance is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Nhập số tiền thực tế kiểm kê.",
                )

            difference = payload.actual_balance - int(account["current_balance"])
            if difference == 0:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Số dư thực tế đang khớp số dư hệ thống.",
                )

            expected_direction = "IN" if difference > 0 else "OUT"
            if direction != expected_direction:
                label = "phiếu thu" if expected_direction == "IN" else "phiếu chi"
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Chênh lệch kiểm kê phải tạo bằng {label}.",
                )

            amount = abs(difference)
            reference = next_reference_code(
                connection,
                direction,
                payload.transaction_time,
            )
            created_ids.append(
                insert_transaction(
                    connection,
                    fund_account_id=payload.fund_account_id,
                    transaction_time=payload.transaction_time,
                    transaction_type=transaction_type,
                    category_id=None,
                    direction=direction,
                    amount=amount,
                    reference_code=reference,
                    group_id=None,
                    description=description or "Cân đối kiểm kê",
                    note=note,
                )
            )
            reference_codes.append(reference)

        elif transaction_type == "TRANSFER":
            if payload.related_fund_account_id is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Chọn quỹ/tài khoản đối ứng.",
                )
            if payload.related_fund_account_id == payload.fund_account_id:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Không thể chuyển tiền trong cùng một quỹ/tài khoản.",
                )
            if payload.amount is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Nhập số tiền chuyển.",
                )

            related = get_account(connection, payload.related_fund_account_id)
            if not bool(related["is_active"]):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Quỹ/tài khoản đối ứng đang ngừng sử dụng.",
                )

            if direction == "OUT":
                source_account_id = payload.fund_account_id
                target_account_id = payload.related_fund_account_id
            else:
                source_account_id = payload.related_fund_account_id
                target_account_id = payload.fund_account_id

            source = get_account(connection, source_account_id)
            if int(source["current_balance"]) < payload.amount:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Số dư nguồn không đủ để chuyển quỹ.",
                )

            group_id = f"TRF-{uuid.uuid4().hex[:12].upper()}"
            out_reference = next_reference_code(
                connection,
                "OUT",
                payload.transaction_time,
            )
            in_reference = next_reference_code(
                connection,
                "IN",
                payload.transaction_time,
            )

            transfer_description = description or "Chuyển quỹ"

            created_ids.append(
                insert_transaction(
                    connection,
                    fund_account_id=source_account_id,
                    transaction_time=payload.transaction_time,
                    transaction_type=transaction_type,
                    category_id=None,
                    direction="OUT",
                    amount=payload.amount,
                    reference_code=out_reference,
                    group_id=group_id,
                    description=transfer_description,
                    note=note,
                )
            )
            reference_codes.append(out_reference)

            created_ids.append(
                insert_transaction(
                    connection,
                    fund_account_id=target_account_id,
                    transaction_time=payload.transaction_time,
                    transaction_type=transaction_type,
                    category_id=None,
                    direction="IN",
                    amount=payload.amount,
                    reference_code=in_reference,
                    group_id=group_id,
                    description=transfer_description,
                    note=note,
                )
            )
            reference_codes.append(in_reference)

        else:
            if payload.amount is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Nhập số tiền.",
                )
            if payload.category_id is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Chọn loại thu/chi.",
                )

            get_category(connection, payload.category_id, direction)

            if direction == "OUT" and int(account["current_balance"]) < payload.amount:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Số dư quỹ/tài khoản không đủ.",
                )

            reference = next_reference_code(
                connection,
                direction,
                payload.transaction_time,
            )
            created_ids.append(
                insert_transaction(
                    connection,
                    fund_account_id=payload.fund_account_id,
                    transaction_time=payload.transaction_time,
                    transaction_type=transaction_type,
                    category_id=payload.category_id,
                    direction=direction,
                    amount=payload.amount,
                    reference_code=reference,
                    group_id=None,
                    description=description,
                    note=note,
                    source_type=clean_text(payload.source_type),
                    source_id=clean_text(payload.source_id),
                )
            )
            reference_codes.append(reference)

        connection.commit()

    backup_database(reason="fund-transaction-created")
    return FundTransactionCreateOutput(
        created_ids=created_ids,
        reference_codes=reference_codes,
    )


@router.get("", response_model=FundTransactionListOutput)
def list_fund_transactions(
    account_type: str = Query(...),
    fund_account_id: int | None = Query(default=None),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
) -> FundTransactionListOutput:
    normalized_type = normalize_account_type(account_type)

    if from_date and to_date and from_date > to_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Từ ngày không được lớn hơn đến ngày.",
        )

    with connect() as connection:
        if fund_account_id is not None:
            account = connection.execute(
                """
                SELECT id
                FROM fund_accounts
                WHERE id = ? AND type = ?
                """,
                (fund_account_id, normalized_type),
            ).fetchone()

            if account is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Không tìm thấy quỹ/tài khoản phù hợp.",
                )

        where_parts = [
            "t.is_void = 0",
            "a.type = ?",
        ]
        params: list[object] = [normalized_type]

        if fund_account_id is not None:
            where_parts.append("t.fund_account_id = ?")
            params.append(fund_account_id)

        opening_where = list(where_parts)
        opening_params = list(params)

        if from_date is not None:
            opening_where.append("date(t.transaction_time) < date(?)")
            opening_params.append(from_date.isoformat())

        opening_row = connection.execute(
            f"""
            SELECT COALESCE(SUM(
                CASE
                    WHEN t.direction = 'IN' THEN t.amount
                    ELSE -t.amount
                END
            ), 0) AS opening_balance
            FROM fund_transactions AS t
            JOIN fund_accounts AS a ON a.id = t.fund_account_id
            LEFT JOIN fund_transaction_categories AS c ON c.id = t.category_id
            WHERE {" AND ".join(opening_where)}
            """,
            opening_params,
        ).fetchone()
        opening_balance = int(opening_row["opening_balance"])

        range_where = list(where_parts)
        range_params = list(params)

        if from_date is not None:
            range_where.append("date(t.transaction_time) >= date(?)")
            range_params.append(from_date.isoformat())

        if to_date is not None:
            range_where.append("date(t.transaction_time) <= date(?)")
            range_params.append(to_date.isoformat())

        rows = connection.execute(
            f"""
            SELECT
                t.id,
                t.fund_account_id,
                a.name AS fund_account_name,
                a.type AS account_type,
                t.transaction_time,
                t.transaction_type,
                t.category_id,
                c.name AS category_name,
                t.direction,
                t.amount,
                t.reference_code,
                t.description,
                t.note
            FROM fund_transactions AS t
            JOIN fund_accounts AS a ON a.id = t.fund_account_id
            LEFT JOIN fund_transaction_categories AS c ON c.id = t.category_id
            WHERE {" AND ".join(range_where)}
            ORDER BY t.transaction_time ASC, t.id ASC
            """,
            range_params,
        ).fetchall()

    running_balance = opening_balance
    total_in = 0
    total_out = 0
    items: list[FundTransactionOutput] = []

    for row in rows:
        amount = int(row["amount"])

        if row["direction"] == "IN":
            total_in += amount
            running_balance += amount
        else:
            total_out += amount
            running_balance -= amount

        items.append(
            FundTransactionOutput(
                id=row["id"],
                fund_account_id=row["fund_account_id"],
                fund_account_name=row["fund_account_name"],
                account_type=row["account_type"],
                transaction_time=row["transaction_time"],
                transaction_type=row["transaction_type"],
                category_id=row["category_id"],
                category_name=row["category_name"],
                direction=row["direction"],
                amount=amount,
                reference_code=row["reference_code"],
                description=row["description"],
                note=row["note"],
                running_balance=running_balance,
            )
        )

    return FundTransactionListOutput(
        opening_balance=opening_balance,
        total_in=total_in,
        total_out=total_out,
        closing_balance=running_balance,
        items=items,
    )
