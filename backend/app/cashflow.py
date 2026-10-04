import sqlite3
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect
from .fund_transactions import get_account, insert_transaction, next_reference_code

router = APIRouter(prefix="/api/cashflow", tags=["cashflow"])


class CategoryInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    direction: str
    is_active: bool = True


class CategoryOutput(BaseModel):
    id: int
    name: str
    direction: str
    is_active: bool


class CashflowInput(BaseModel):
    direction: str
    category_id: int
    fund_account_id: int
    transaction_time: str
    amount: int = Field(ge=1)
    supplier_id: int | None = None
    description: str = Field(min_length=1, max_length=500)
    note: str | None = Field(default=None, max_length=1000)


class CashflowOutput(BaseModel):
    id: int
    direction: str
    category_id: int
    category_name: str
    fund_account_id: int
    fund_account_name: str
    account_type: str
    transaction_time: str
    amount: int
    supplier_id: int | None
    supplier_name: str | None
    description: str
    note: str | None
    reference_code: str
    fund_transaction_id: int


def norm_direction(value: str) -> str:
    value = value.strip().upper()
    if value not in {"IN", "OUT"}:
        raise HTTPException(status_code=422, detail="Loại thu/chi không hợp lệ.")
    return value


def clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


@router.get("/categories", response_model=list[CategoryOutput])
def list_categories(direction: str | None = Query(default=None)) -> list[CategoryOutput]:
    params: list[object] = []
    where = ""
    if direction:
        where = "WHERE direction = ?"
        params.append(norm_direction(direction))
    with connect() as connection:
        rows = connection.execute(
            f"SELECT id, name, direction, is_active FROM cashflow_categories {where} ORDER BY direction, name COLLATE NOCASE",
            params,
        ).fetchall()
    return [CategoryOutput(id=r["id"], name=r["name"], direction=r["direction"], is_active=bool(r["is_active"])) for r in rows]


@router.post("/categories", response_model=CategoryOutput, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryInput) -> CategoryOutput:
    name = payload.name.strip()
    direction = norm_direction(payload.direction)
    try:
        with connect() as connection:
            cursor = connection.execute(
                "INSERT INTO cashflow_categories (name, direction, is_active) VALUES (?, ?, ?)",
                (name, direction, int(payload.is_active)),
            )
            connection.commit()
            category_id = int(cursor.lastrowid)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Nhóm thu/chi đã tồn tại.")
    backup_database(reason="cashflow-category-created")
    return CategoryOutput(id=category_id, name=name, direction=direction, is_active=payload.is_active)


@router.put("/categories/{category_id}", response_model=CategoryOutput)
def update_category(category_id: int, payload: CategoryInput) -> CategoryOutput:
    name = payload.name.strip()
    direction = norm_direction(payload.direction)
    try:
        with connect() as connection:
            current = connection.execute("SELECT direction FROM cashflow_categories WHERE id = ?", (category_id,)).fetchone()
            if current is None:
                raise HTTPException(status_code=404, detail="Không tìm thấy nhóm thu/chi.")
            used = connection.execute("SELECT 1 FROM cashflow_entries WHERE category_id = ? LIMIT 1", (category_id,)).fetchone()
            if used and current["direction"] != direction:
                raise HTTPException(status_code=409, detail="Nhóm đã phát sinh chứng từ nên không thể đổi Thu/Chi.")
            connection.execute(
                "UPDATE cashflow_categories SET name = ?, direction = ?, is_active = ? WHERE id = ?",
                (name, direction, int(payload.is_active), category_id),
            )
            connection.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Nhóm thu/chi đã tồn tại.")
    backup_database(reason="cashflow-category-updated")
    return CategoryOutput(id=category_id, name=name, direction=direction, is_active=payload.is_active)


@router.get("/entries", response_model=list[CashflowOutput])
def list_entries(
    direction: str | None = Query(default=None),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
) -> list[CashflowOutput]:
    where = ["1=1"]
    params: list[object] = []
    if direction:
        where.append("e.direction = ?")
        params.append(norm_direction(direction))
    if from_date:
        where.append("date(e.transaction_time) >= date(?)")
        params.append(from_date.isoformat())
    if to_date:
        where.append("date(e.transaction_time) <= date(?)")
        params.append(to_date.isoformat())
    with connect() as connection:
        rows = connection.execute(
            f"""
            SELECT e.*, c.name category_name, a.name fund_account_name, a.type account_type,
                   s.name supplier_name, t.reference_code
            FROM cashflow_entries e
            JOIN cashflow_categories c ON c.id = e.category_id
            JOIN fund_accounts a ON a.id = e.fund_account_id
            LEFT JOIN suppliers s ON s.id = e.supplier_id
            JOIN fund_transactions t ON t.id = e.fund_transaction_id
            WHERE {" AND ".join(where)}
            ORDER BY e.transaction_time DESC, e.id DESC
            """,
            params,
        ).fetchall()
    return [CashflowOutput(**dict(r)) for r in rows]


@router.post("/entries", response_model=CashflowOutput, status_code=status.HTTP_201_CREATED)
def create_entry(payload: CashflowInput) -> CashflowOutput:
    direction = norm_direction(payload.direction)
    description = payload.description.strip()
    note = clean(payload.note)
    try:
        datetime.fromisoformat(payload.transaction_time)
    except ValueError:
        raise HTTPException(status_code=422, detail="Ngày chứng từ không hợp lệ.")

    with connect() as connection:
        category = connection.execute(
            "SELECT id, name, direction, is_active FROM cashflow_categories WHERE id = ?",
            (payload.category_id,),
        ).fetchone()
        if category is None or not bool(category["is_active"]):
            raise HTTPException(status_code=422, detail="Nhóm thu/chi không hợp lệ hoặc đã ngừng sử dụng.")
        if category["direction"] != direction:
            raise HTTPException(status_code=422, detail="Nhóm không đúng loại Thu/Chi.")

        account = get_account(connection, payload.fund_account_id)
        if not bool(account["is_active"]):
            raise HTTPException(status_code=409, detail="Quỹ/tài khoản đang ngừng sử dụng.")
        if direction == "OUT" and int(account["current_balance"]) < payload.amount:
            raise HTTPException(status_code=409, detail="Số dư quỹ/tài khoản không đủ.")

        supplier_name = None
        if payload.supplier_id is not None:
            supplier = connection.execute("SELECT id, name FROM suppliers WHERE id = ?", (payload.supplier_id,)).fetchone()
            if supplier is None:
                raise HTTPException(status_code=404, detail="Không tìm thấy nhà cung cấp.")
            supplier_name = supplier["name"]

        reference = next_reference_code(connection, direction, payload.transaction_time)
        transaction_id = insert_transaction(
            connection,
            fund_account_id=payload.fund_account_id,
            transaction_time=payload.transaction_time,
            transaction_type="NORMAL",
            direction=direction,
            amount=payload.amount,
            reference_code=reference,
            group_id=None,
            description=description,
            note=note,
        )
        cursor = connection.execute(
            """
            INSERT INTO cashflow_entries (
                direction, category_id, fund_account_id, transaction_time, amount,
                supplier_id, description, note, fund_transaction_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (direction, payload.category_id, payload.fund_account_id, payload.transaction_time,
             payload.amount, payload.supplier_id, description, note, transaction_id),
        )
        entry_id = int(cursor.lastrowid)
        connection.commit()

    backup_database(reason="cashflow-entry-created")
    return CashflowOutput(
        id=entry_id, direction=direction, category_id=payload.category_id,
        category_name=category["name"], fund_account_id=payload.fund_account_id,
        fund_account_name=account["name"], account_type=account["type"],
        transaction_time=payload.transaction_time, amount=payload.amount,
        supplier_id=payload.supplier_id, supplier_name=supplier_name,
        description=description, note=note, reference_code=reference,
        fund_transaction_id=transaction_id,
    )
