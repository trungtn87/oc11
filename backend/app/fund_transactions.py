from datetime import date

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from .database import connect

router = APIRouter(prefix="/api/fund-transactions", tags=["fund-transactions"])


class FundTransactionOutput(BaseModel):
    id: int
    fund_account_id: int
    fund_account_name: str
    account_type: str
    transaction_time: str
    transaction_type: str
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


def normalize_account_type(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in {"CASH", "BANK"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loại sổ tiền không hợp lệ.",
        )
    return normalized


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
                t.direction,
                t.amount,
                t.reference_code,
                t.description,
                t.note
            FROM fund_transactions AS t
            JOIN fund_accounts AS a ON a.id = t.fund_account_id
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
