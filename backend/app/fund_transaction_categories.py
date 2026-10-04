import sqlite3

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(
    prefix="/api/fund-transaction-categories",
    tags=["fund-transaction-categories"],
)


class FundTransactionCategoryInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    direction: str
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0)


class FundTransactionCategoryOutput(BaseModel):
    id: int
    name: str
    direction: str
    is_active: bool
    sort_order: int
    can_change_direction: bool


def normalize_direction(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in {"IN", "OUT"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loại thu/chi không hợp lệ.",
        )
    return normalized


def clean_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nhập tên loại thu/chi.",
        )
    return name


def category_output(connection: sqlite3.Connection, category_id: int) -> FundTransactionCategoryOutput:
    row = connection.execute(
        """
        SELECT
            c.id,
            c.name,
            c.direction,
            c.is_active,
            c.sort_order,
            NOT EXISTS (
                SELECT 1
                FROM fund_transactions t
                WHERE t.category_id = c.id
            ) AS can_change_direction
        FROM fund_transaction_categories c
        WHERE c.id = ?
        """,
        (category_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy loại thu/chi.")

    return FundTransactionCategoryOutput(
        id=row["id"],
        name=row["name"],
        direction=row["direction"],
        is_active=bool(row["is_active"]),
        sort_order=row["sort_order"],
        can_change_direction=bool(row["can_change_direction"]),
    )


@router.get("", response_model=list[FundTransactionCategoryOutput])
def list_categories(
    direction: str | None = Query(default=None),
) -> list[FundTransactionCategoryOutput]:
    where = ""
    params: list[object] = []
    if direction is not None:
        where = "WHERE c.direction = ?"
        params.append(normalize_direction(direction))

    with connect() as connection:
        rows = connection.execute(
            f"""
            SELECT
                c.id,
                c.name,
                c.direction,
                c.is_active,
                c.sort_order,
                NOT EXISTS (
                    SELECT 1
                    FROM fund_transactions t
                    WHERE t.category_id = c.id
                ) AS can_change_direction
            FROM fund_transaction_categories c
            {where}
            ORDER BY c.direction, c.sort_order, c.name COLLATE NOCASE
            """,
            params,
        ).fetchall()

    return [
        FundTransactionCategoryOutput(
            id=row["id"],
            name=row["name"],
            direction=row["direction"],
            is_active=bool(row["is_active"]),
            sort_order=row["sort_order"],
            can_change_direction=bool(row["can_change_direction"]),
        )
        for row in rows
    ]


@router.post(
    "",
    response_model=FundTransactionCategoryOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_category(
    payload: FundTransactionCategoryInput,
) -> FundTransactionCategoryOutput:
    name = clean_name(payload.name)
    direction = normalize_direction(payload.direction)

    try:
        with connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO fund_transaction_categories (
                    name, direction, is_active, sort_order
                )
                VALUES (?, ?, ?, ?)
                """,
                (name, direction, int(payload.is_active), payload.sort_order),
            )
            category_id = int(cursor.lastrowid)
            connection.commit()
            result = category_output(connection, category_id)
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tên loại thu/chi đã tồn tại.",
        )

    backup_database(reason="fund-transaction-category-created")
    return result


@router.put("/{category_id}", response_model=FundTransactionCategoryOutput)
def update_category(
    category_id: int,
    payload: FundTransactionCategoryInput,
) -> FundTransactionCategoryOutput:
    name = clean_name(payload.name)
    direction = normalize_direction(payload.direction)

    try:
        with connect() as connection:
            current = connection.execute(
                """
                SELECT id, direction
                FROM fund_transaction_categories
                WHERE id = ?
                """,
                (category_id,),
            ).fetchone()
            if current is None:
                raise HTTPException(status_code=404, detail="Không tìm thấy loại thu/chi.")

            if current["direction"] != direction:
                used = connection.execute(
                    """
                    SELECT 1
                    FROM fund_transactions
                    WHERE category_id = ?
                    LIMIT 1
                    """,
                    (category_id,),
                ).fetchone()
                if used is not None:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Loại đã phát sinh giao dịch nên không thể đổi Thu/Chi.",
                    )

            connection.execute(
                """
                UPDATE fund_transaction_categories
                SET name = ?, direction = ?, is_active = ?, sort_order = ?
                WHERE id = ?
                """,
                (
                    name,
                    direction,
                    int(payload.is_active),
                    payload.sort_order,
                    category_id,
                ),
            )
            connection.commit()
            result = category_output(connection, category_id)
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tên loại thu/chi đã tồn tại.",
        )

    backup_database(reason="fund-transaction-category-updated")
    return result
