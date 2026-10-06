import json
import sqlite3
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .consumption import record_sale_consumption
from .database import connect
from .menu import (
    calculate_menu_ingredients,
    calculate_menu_option,
)

router = APIRouter(prefix="/api/sales", tags=["sales"])


class SaleSurchargeInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    amount: int = Field(gt=0)


class SaleOrderItemInput(BaseModel):
    menu_item_id: int
    menu_item_option_id: int | None = None
    quantity: float = Field(gt=0)
    note: str | None = Field(default=None, max_length=300)
    surcharges: list[SaleSurchargeInput] = Field(default_factory=list)


class SaleOrderInput(BaseModel):
    order_time: str | None = None
    customer_id: int | None = None
    note: str | None = Field(default=None, max_length=500)
    items: list[SaleOrderItemInput] = Field(min_length=1)
    surcharges: list[SaleSurchargeInput] = Field(default_factory=list)
    fund_account_id: int | None = None
    actual_received_amount: int | None = Field(default=None, ge=0)


class SalePaymentInput(BaseModel):
    fund_account_id: int
    actual_received_amount: int | None = Field(default=None, ge=0)


class SaleSurchargeOutput(BaseModel):
    id: int
    name: str
    amount: int


class SaleOrderItemOutput(BaseModel):
    id: int
    menu_item_id: int | None
    menu_item_option_id: int | None
    item_name_snapshot: str
    option_name_snapshot: str | None
    unit_name_snapshot: str
    quantity: float
    unit_price: int
    line_total: int
    surcharge_total: int
    total_with_surcharges: int
    unit_cost_snapshot: float | None
    cost_total_snapshot: float | None
    note: str | None
    surcharges: list[SaleSurchargeOutput] = Field(default_factory=list)


class SaleOrderOutput(BaseModel):
    id: int
    order_code: str
    order_time: str
    status: str
    customer_id: int | None
    customer_name: str | None
    fund_account_id: int | None
    fund_account_name: str | None
    total_amount: int
    surcharge_total: int
    actual_received_amount: int | None
    payment_reference_code: str | None
    paid_at: str | None
    note: str | None
    void_reason: str | None
    voided_at: str | None
    created_at: str
    updated_at: str | None
    stock_deducted: bool
    has_einvoice: bool
    einvoice_issued_at: str | None
    can_edit: bool
    can_delete: bool
    items: list[SaleOrderItemOutput] = Field(default_factory=list)
    surcharges: list[SaleSurchargeOutput] = Field(default_factory=list)


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def normalize_datetime(value: str | None) -> str:
    if value is None or not value.strip():
        return datetime.now().isoformat(timespec="microseconds")
    try:
        return datetime.fromisoformat(value.strip()).isoformat(timespec="microseconds")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Thời gian bán không hợp lệ.",
        ) from exc


def next_order_code(connection: sqlite3.Connection) -> str:
    row = connection.execute(
        "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM sales_orders"
    ).fetchone()
    return f"BH{int(row['next_id']):06d}"


def next_receipt_reference(connection: sqlite3.Connection, transaction_time: str) -> str:
    day_key = datetime.fromisoformat(transaction_time).strftime("%Y%m%d")
    pattern = f"PT-{day_key}-%"
    row = connection.execute(
        """
        SELECT COUNT(*) AS total
        FROM fund_transactions
        WHERE reference_code LIKE ?
        """,
        (pattern,),
    ).fetchone()
    return f"PT-{day_key}-{int(row['total']) + 1:03d}"


def ensure_customer(
    connection: sqlite3.Connection,
    customer_id: int | None,
) -> None:
    if customer_id is None:
        return
    row = connection.execute(
        "SELECT id, is_active FROM customers WHERE id = ?",
        (customer_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy khách hàng.",
        )
    if not bool(row["is_active"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Khách hàng đang ngừng sử dụng.",
        )


def build_line_snapshot(
    connection: sqlite3.Connection,
    line: SaleOrderItemInput,
) -> dict[str, object]:
    item = connection.execute(
        """
        SELECT
            mi.id,
            mi.name,
            mi.base_price,
            mi.is_active,
            u.name AS sale_unit_name
        FROM menu_items AS mi
        JOIN units AS u ON u.id = mi.sale_unit_id
        WHERE mi.id = ?
        """,
        (line.menu_item_id,),
    ).fetchone()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy món bán.",
        )
    if not bool(item["is_active"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Món {item['name']} đang ngừng bán.",
        )

    active_option = connection.execute(
        """
        SELECT id
        FROM menu_item_options
        WHERE menu_item_id = ? AND is_active = 1
        LIMIT 1
        """,
        (line.menu_item_id,),
    ).fetchone()

    option_name: str | None = None
    unit_price = int(item["base_price"])
    unit_cost: float | None = None

    if line.menu_item_option_id is not None:
        option = connection.execute(
            """
            SELECT
                mio.id,
                mio.menu_item_id,
                mio.extra_price,
                mio.is_active,
                so.name AS service_option_name
            FROM menu_item_options AS mio
            JOIN service_options AS so ON so.id = mio.service_option_id
            WHERE mio.id = ?
            """,
            (line.menu_item_option_id,),
        ).fetchone()
        if option is None or int(option["menu_item_id"]) != line.menu_item_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Kiểu chế biến không thuộc món {item['name']}.",
            )
        if not bool(option["is_active"]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Kiểu chế biến của món {item['name']} đang ngừng sử dụng.",
            )
        option_name = option["service_option_name"]
        unit_price += int(option["extra_price"])
        _, current_cost, complete = calculate_menu_option(
            connection,
            line.menu_item_option_id,
        )
        if complete and current_cost is not None:
            unit_cost = float(current_cost)
    else:
        if active_option is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Chọn kiểu chế biến cho món {item['name']}.",
            )
        ingredients, current_cost, complete = calculate_menu_ingredients(
            connection,
            line.menu_item_id,
        )
        if ingredients and complete:
            unit_cost = float(current_cost)

    quantity = float(line.quantity)
    line_total = int(round(quantity * unit_price))
    cost_total = unit_cost * quantity if unit_cost is not None else None

    return {
        "menu_item_id": line.menu_item_id,
        "menu_item_option_id": line.menu_item_option_id,
        "item_name_snapshot": item["name"],
        "option_name_snapshot": option_name,
        "unit_name_snapshot": item["sale_unit_name"],
        "quantity": quantity,
        "unit_price": unit_price,
        "line_total": line_total,
        "unit_cost_snapshot": unit_cost,
        "cost_total_snapshot": cost_total,
        "note": clean_text(line.note),
    }


def normalize_surcharge(surcharge: SaleSurchargeInput) -> tuple[str, int]:
    name = clean_text(surcharge.name)
    if name is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên phụ thu không được để trống.",
        )
    return name, int(surcharge.amount)


def insert_item_surcharges(
    connection: sqlite3.Connection,
    sales_order_item_id: int,
    surcharges: list[SaleSurchargeInput],
) -> int:
    total = 0
    for surcharge in surcharges:
        name, amount = normalize_surcharge(surcharge)
        connection.execute(
            """
            INSERT INTO sales_order_item_surcharges (
                sales_order_item_id,
                name,
                amount
            )
            VALUES (?, ?, ?)
            """,
            (sales_order_item_id, name, amount),
        )
        total += amount
    return total


def insert_order_surcharges(
    connection: sqlite3.Connection,
    order_id: int,
    surcharges: list[SaleSurchargeInput],
) -> int:
    total = 0
    for surcharge in surcharges:
        name, amount = normalize_surcharge(surcharge)
        connection.execute(
            """
            INSERT INTO sales_order_surcharges (
                sales_order_id,
                name,
                amount
            )
            VALUES (?, ?, ?)
            """,
            (order_id, name, amount),
        )
        total += amount
    return total


def insert_order_items(
    connection: sqlite3.Connection,
    order_id: int,
    items: list[SaleOrderItemInput],
) -> int:
    total = 0
    for line in items:
        snapshot = build_line_snapshot(connection, line)
        cursor = connection.execute(
            """
            INSERT INTO sales_order_items (
                sales_order_id,
                menu_item_id,
                menu_item_option_id,
                item_name_snapshot,
                option_name_snapshot,
                unit_name_snapshot,
                quantity,
                unit_price,
                line_total,
                unit_cost_snapshot,
                cost_total_snapshot,
                note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                order_id,
                snapshot["menu_item_id"],
                snapshot["menu_item_option_id"],
                snapshot["item_name_snapshot"],
                snapshot["option_name_snapshot"],
                snapshot["unit_name_snapshot"],
                snapshot["quantity"],
                snapshot["unit_price"],
                snapshot["line_total"],
                snapshot["unit_cost_snapshot"],
                snapshot["cost_total_snapshot"],
                snapshot["note"],
            ),
        )
        line_id = int(cursor.lastrowid)
        surcharge_total = insert_item_surcharges(
            connection,
            line_id,
            line.surcharges,
        )
        total += int(snapshot["line_total"]) + surcharge_total
    return total
def select_order(
    connection: sqlite3.Connection,
    order_id: int,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            so.id,
            so.order_code,
            so.order_time,
            so.status,
            so.customer_id,
            c.name AS customer_name,
            so.fund_account_id,
            fa.name AS fund_account_name,
            so.total_amount,
            so.actual_received_amount,
            so.payment_reference_code,
            so.paid_at,
            so.note,
            so.void_reason,
            so.voided_at,
            so.created_at,
            so.updated_at,
            EXISTS (
                SELECT 1
                FROM inventory_movements AS im
                WHERE im.source_type = 'SALE'
                  AND im.source_id = CAST(so.id AS TEXT)
            ) AS stock_deducted,
            EXISTS (
                SELECT 1
                FROM electronic_invoices AS ei
                WHERE ei.sales_order_id = so.id
                  AND ei.issued_at IS NOT NULL
            ) AS has_einvoice,
            (
                SELECT MAX(ei.issued_at)
                FROM electronic_invoices AS ei
                WHERE ei.sales_order_id = so.id
                  AND ei.issued_at IS NOT NULL
            ) AS einvoice_issued_at
        FROM sales_orders AS so
        LEFT JOIN customers AS c ON c.id = so.customer_id
        LEFT JOIN fund_accounts AS fa ON fa.id = so.fund_account_id
        WHERE so.id = ?
        """,
        (order_id,),
    ).fetchone()


def select_order_items(
    connection: sqlite3.Connection,
    order_id: int,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT
            id,
            menu_item_id,
            menu_item_option_id,
            item_name_snapshot,
            option_name_snapshot,
            unit_name_snapshot,
            quantity,
            unit_price,
            line_total,
            unit_cost_snapshot,
            cost_total_snapshot,
            note
        FROM sales_order_items
        WHERE sales_order_id = ?
        ORDER BY id ASC
        """,
        (order_id,),
    ).fetchall()


def select_item_surcharges(
    connection: sqlite3.Connection,
    sales_order_item_id: int,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT id, name, amount
        FROM sales_order_item_surcharges
        WHERE sales_order_item_id = ?
        ORDER BY id ASC
        """,
        (sales_order_item_id,),
    ).fetchall()


def select_order_surcharges(
    connection: sqlite3.Connection,
    order_id: int,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT id, name, amount
        FROM sales_order_surcharges
        WHERE sales_order_id = ?
        ORDER BY id ASC
        """,
        (order_id,),
    ).fetchall()


def surcharge_rows_to_output(
    rows: list[sqlite3.Row],
) -> list[SaleSurchargeOutput]:
    return [
        SaleSurchargeOutput(
            id=int(row["id"]),
            name=row["name"],
            amount=int(row["amount"]),
        )
        for row in rows
    ]


def order_to_output(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
) -> SaleOrderOutput:
    items: list[SaleOrderItemOutput] = []
    item_surcharge_total = 0

    for item in select_order_items(connection, int(row["id"])):
        surcharges = surcharge_rows_to_output(
            select_item_surcharges(connection, int(item["id"]))
        )
        surcharge_total = sum(surcharge.amount for surcharge in surcharges)
        item_surcharge_total += surcharge_total
        items.append(
            SaleOrderItemOutput(
                id=int(item["id"]),
                menu_item_id=(
                    int(item["menu_item_id"])
                    if item["menu_item_id"] is not None
                    else None
                ),
                menu_item_option_id=(
                    int(item["menu_item_option_id"])
                    if item["menu_item_option_id"] is not None
                    else None
                ),
                item_name_snapshot=item["item_name_snapshot"],
                option_name_snapshot=item["option_name_snapshot"],
                unit_name_snapshot=item["unit_name_snapshot"],
                quantity=float(item["quantity"]),
                unit_price=int(item["unit_price"]),
                line_total=int(item["line_total"]),
                surcharge_total=surcharge_total,
                total_with_surcharges=int(item["line_total"]) + surcharge_total,
                unit_cost_snapshot=(
                    float(item["unit_cost_snapshot"])
                    if item["unit_cost_snapshot"] is not None
                    else None
                ),
                cost_total_snapshot=(
                    float(item["cost_total_snapshot"])
                    if item["cost_total_snapshot"] is not None
                    else None
                ),
                note=item["note"],
                surcharges=surcharges,
            )
        )

    order_surcharges = surcharge_rows_to_output(
        select_order_surcharges(connection, int(row["id"]))
    )
    order_surcharge_total = sum(
        surcharge.amount for surcharge in order_surcharges
    )

    return SaleOrderOutput(
        id=int(row["id"]),
        order_code=row["order_code"],
        order_time=row["order_time"],
        status=row["status"],
        customer_id=(
            int(row["customer_id"]) if row["customer_id"] is not None else None
        ),
        customer_name=row["customer_name"],
        fund_account_id=(
            int(row["fund_account_id"])
            if row["fund_account_id"] is not None
            else None
        ),
        fund_account_name=row["fund_account_name"],
        total_amount=int(row["total_amount"]),
        surcharge_total=item_surcharge_total + order_surcharge_total,
        actual_received_amount=(
            int(row["actual_received_amount"])
            if row["actual_received_amount"] is not None
            else None
        ),
        payment_reference_code=row["payment_reference_code"],
        paid_at=row["paid_at"],
        note=row["note"],
        void_reason=row["void_reason"],
        voided_at=row["voided_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        stock_deducted=bool(row["stock_deducted"]),
        has_einvoice=bool(row["has_einvoice"]),
        einvoice_issued_at=row["einvoice_issued_at"],
        can_edit=(
            not bool(row["has_einvoice"])
            and row["status"] != "VOID"
        ),
        can_delete=(
            not bool(row["has_einvoice"])
            and row["status"] != "VOID"
        ),
        items=items,
        surcharges=order_surcharges,
    )
def get_sale_category_id(connection: sqlite3.Connection) -> int:
    row = connection.execute(
        """
        SELECT id
        FROM fund_transaction_categories
        WHERE name = 'Bán hàng' COLLATE NOCASE
          AND direction = 'IN'
        LIMIT 1
        """
    ).fetchone()
    if row is not None:
        return int(row["id"])
    cursor = connection.execute(
        """
        INSERT INTO fund_transaction_categories (
            name, direction, is_active, sort_order
        )
        VALUES ('Bán hàng', 'IN', 1, 0)
        """
    )
    return int(cursor.lastrowid)


def ensure_not_invoiced(row: sqlite3.Row) -> None:
    if bool(row["has_einvoice"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Đơn đã phát hành hóa đơn điện tử nên không thể sửa hoặc xóa.",
        )


def record_order_revision(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    action: str,
    new_total_amount: int | None,
    reason: str | None = None,
) -> None:
    snapshot = {
        "order_code": row["order_code"],
        "status": row["status"],
        "total_amount": int(row["total_amount"]),
        "actual_received_amount": (
            int(row["actual_received_amount"])
            if row["actual_received_amount"] is not None
            else None
        ),
        "fund_account_id": (
            int(row["fund_account_id"])
            if row["fund_account_id"] is not None
            else None
        ),
        "payment_reference_code": row["payment_reference_code"],
        "paid_at": row["paid_at"],
    }
    connection.execute(
        """
        INSERT INTO sales_order_revisions (
            sales_order_id,
            action,
            previous_total_amount,
            new_total_amount,
            reason,
            snapshot_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            int(row["id"]),
            action,
            int(row["total_amount"]),
            new_total_amount,
            clean_text(reason),
            json.dumps(snapshot, ensure_ascii=False),
        ),
    )


def reverse_paid_effects(
    connection: sqlite3.Connection,
    order: sqlite3.Row,
    reversed_at: str,
    *,
    note_prefix: str,
) -> None:
    payment = connection.execute(
        """
        SELECT id, fund_account_id, amount
        FROM fund_transactions
        WHERE source_type = 'SALE'
          AND source_id = ?
          AND direction = 'IN'
          AND is_void = 0
        ORDER BY id DESC
        LIMIT 1
        """,
        (str(int(order["id"])),),
    ).fetchone()
    if payment is not None:
        connection.execute(
            "UPDATE fund_transactions SET is_void = 1 WHERE id = ?",
            (int(payment["id"]),),
        )
        connection.execute(
            """
            UPDATE fund_accounts
            SET current_balance = current_balance - ?
            WHERE id = ?
            """,
            (int(payment["amount"]), int(payment["fund_account_id"])),
        )

    sale_movements = connection.execute(
        """
        SELECT
            im.item_id,
            im.quantity_delta,
            im.source_line_id
        FROM inventory_movements AS im
        WHERE im.source_type = 'SALE'
          AND im.source_id = ?
          AND NOT EXISTS (
              SELECT 1
              FROM inventory_movements AS reversed
              WHERE reversed.source_type = 'SALE_VOID'
                AND reversed.source_id = im.source_id
                AND reversed.item_id = im.item_id
                AND COALESCE(reversed.source_line_id, '') =
                    COALESCE(im.source_line_id, '')
          )
        ORDER BY im.id ASC
        """,
        (str(int(order["id"])),),
    ).fetchall()

    for movement in sale_movements:
        connection.execute(
            """
            INSERT INTO inventory_movements (
                item_id,
                movement_time,
                quantity_delta,
                source_type,
                source_id,
                source_line_id,
                note,
                created_at
            )
            VALUES (?, ?, ?, 'SALE_VOID', ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                int(movement["item_id"]),
                reversed_at,
                -float(movement["quantity_delta"]),
                str(int(order["id"])),
                movement["source_line_id"],
                f"{note_prefix} {order['order_code']}",
            ),
        )


def apply_payment(
    connection: sqlite3.Connection,
    order_id: int,
    *,
    fund_account_id: int,
    actual_received_amount: int | None,
    paid_at: str,
) -> None:
    order = select_order(connection, order_id)
    assert order is not None

    account = connection.execute(
        """
        SELECT id, name, type, is_active
        FROM fund_accounts
        WHERE id = ?
        """,
        (fund_account_id,),
    ).fetchone()
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy quỹ/tài khoản nhận tiền.",
        )
    if not bool(account["is_active"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Quỹ/tài khoản nhận tiền đang ngừng sử dụng.",
        )

    total_amount = int(order["total_amount"])
    actual_received = (
        total_amount
        if actual_received_amount is None
        else int(actual_received_amount)
    )
    if total_amount > 0 and actual_received <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tiền thực thu phải lớn hơn 0.",
        )

    lines = select_order_items(connection, order_id)
    if not lines:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Đơn bán chưa có món.",
        )

    for line in lines:
        record_sale_consumption(
            connection,
            source_id=str(order_id),
            source_line_id=str(int(line["id"])),
            movement_time=paid_at,
            sold_quantity=float(line["quantity"]),
            menu_item_option_id=(
                int(line["menu_item_option_id"])
                if line["menu_item_option_id"] is not None
                else None
            ),
            menu_item_id=(
                int(line["menu_item_id"])
                if line["menu_item_id"] is not None
                else None
            ),
        )

    payment_reference: str | None = None
    if actual_received > 0:
        category_id = get_sale_category_id(connection)
        payment_reference = next_receipt_reference(connection, paid_at)
        connection.execute(
            """
            INSERT INTO fund_transactions (
                fund_account_id,
                transaction_time,
                transaction_type,
                category_id,
                direction,
                amount,
                source_type,
                source_id,
                reference_code,
                description,
                created_at,
                is_void
            )
            VALUES (?, ?, 'NORMAL', ?, 'IN', ?, 'SALE', ?, ?, ?, CURRENT_TIMESTAMP, 0)
            """,
            (
                fund_account_id,
                paid_at,
                category_id,
                actual_received,
                str(order_id),
                payment_reference,
                f"Bán hàng {order['order_code']}",
            ),
        )
        connection.execute(
            """
            UPDATE fund_accounts
            SET current_balance = current_balance + ?
            WHERE id = ?
            """,
            (actual_received, fund_account_id),
        )

    connection.execute(
        """
        UPDATE sales_orders
        SET status = 'PAID',
            fund_account_id = ?,
            actual_received_amount = ?,
            payment_reference_code = ?,
            paid_at = ?,
            void_reason = NULL,
            voided_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            fund_account_id,
            actual_received,
            payment_reference,
            paid_at,
            order_id,
        ),
    )


@router.get("/orders", response_model=list[SaleOrderOutput])
def list_orders(
    order_status: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
) -> list[SaleOrderOutput]:
    conditions: list[str] = []
    params: list[object] = []

    if order_status and order_status.strip():
        normalized = order_status.strip().upper()
        if normalized not in {"OPEN", "PAID", "VOID"}:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Trạng thái đơn bán không hợp lệ.",
            )
        conditions.append("so.status = ?")
        params.append(normalized)

    if search and search.strip():
        conditions.append(
            "(so.order_code LIKE ? COLLATE NOCASE OR c.name LIKE ? COLLATE NOCASE)"
        )
        value = f"%{search.strip()}%"
        params.extend([value, value])

    if from_date:
        conditions.append("date(so.order_time) >= date(?)")
        params.append(from_date)
    if to_date:
        conditions.append("date(so.order_time) <= date(?)")
        params.append(to_date)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with connect() as connection:
        rows = connection.execute(
            f"""
            SELECT so.id
            FROM sales_orders AS so
            LEFT JOIN customers AS c ON c.id = so.customer_id
            {where}
            ORDER BY so.order_time DESC, so.id DESC
            """,
            tuple(params),
        ).fetchall()

        result: list[SaleOrderOutput] = []
        for item in rows:
            row = select_order(connection, int(item["id"]))
            if row is not None:
                result.append(order_to_output(connection, row))
        return result


@router.get("/orders/{order_id}", response_model=SaleOrderOutput)
def get_order(order_id: int) -> SaleOrderOutput:
    with connect() as connection:
        row = select_order(connection, order_id)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy đơn bán.",
            )
        return order_to_output(connection, row)


@router.post(
    "/orders",
    response_model=SaleOrderOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_order(payload: SaleOrderInput) -> SaleOrderOutput:
    order_time = normalize_datetime(payload.order_time)
    with connect() as connection:
        ensure_customer(connection, payload.customer_id)
        order_code = next_order_code(connection)
        cursor = connection.execute(
            """
            INSERT INTO sales_orders (
                order_code,
                order_time,
                status,
                customer_id,
                total_amount,
                note,
                created_at,
                updated_at
            )
            VALUES (?, ?, 'OPEN', ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                order_code,
                order_time,
                payload.customer_id,
                clean_text(payload.note),
            ),
        )
        order_id = int(cursor.lastrowid)
        total = insert_order_items(connection, order_id, payload.items)
        total += insert_order_surcharges(
            connection,
            order_id,
            payload.surcharges,
        )
        connection.execute(
            "UPDATE sales_orders SET total_amount = ? WHERE id = ?",
            (total, order_id),
        )
        connection.commit()

        row = select_order(connection, order_id)
        assert row is not None
        output = order_to_output(connection, row)

    backup_database(reason="sale-order-created")
    return output


@router.put("/orders/{order_id}", response_model=SaleOrderOutput)
def update_order(order_id: int, payload: SaleOrderInput) -> SaleOrderOutput:
    order_time = normalize_datetime(payload.order_time)
    with connect() as connection:
        existing = select_order(connection, order_id)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy đơn bán.",
            )
        if existing["status"] != "OPEN":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Chỉ đơn chưa thanh toán mới được sửa.",
            )

        ensure_customer(connection, payload.customer_id)
        connection.execute(
            "DELETE FROM sales_order_items WHERE sales_order_id = ?",
            (order_id,),
        )
        connection.execute(
            "DELETE FROM sales_order_surcharges WHERE sales_order_id = ?",
            (order_id,),
        )
        total = insert_order_items(connection, order_id, payload.items)
        total += insert_order_surcharges(
            connection,
            order_id,
            payload.surcharges,
        )
        connection.execute(
            """
            UPDATE sales_orders
            SET order_time = ?,
                customer_id = ?,
                total_amount = ?,
                note = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                order_time,
                payload.customer_id,
                total,
                clean_text(payload.note),
                order_id,
            ),
        )
        connection.commit()

        row = select_order(connection, order_id)
        assert row is not None
        output = order_to_output(connection, row)

    backup_database(reason="sale-order-updated")
    return output


@router.post("/orders/{order_id}/pay", response_model=SaleOrderOutput)
def pay_order(order_id: int, payload: SalePaymentInput) -> SaleOrderOutput:
    paid_at = datetime.now().isoformat(timespec="microseconds")

    with connect() as connection:
        order = select_order(connection, order_id)
        if order is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy đơn bán.",
            )
        if order["status"] != "OPEN":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Đơn bán không còn ở trạng thái chờ thanh toán.",
            )

        account = connection.execute(
            """
            SELECT id, name, type, is_active
            FROM fund_accounts
            WHERE id = ?
            """,
            (payload.fund_account_id,),
        ).fetchone()
        if account is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy quỹ/tài khoản nhận tiền.",
            )
        if not bool(account["is_active"]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Quỹ/tài khoản nhận tiền đang ngừng sử dụng.",
            )

        total_amount = int(order["total_amount"])
        actual_received = (
            total_amount
            if payload.actual_received_amount is None
            else int(payload.actual_received_amount)
        )
        if total_amount > 0 and actual_received <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Tiền thực thu phải lớn hơn 0.",
            )

        lines = select_order_items(connection, order_id)
        if not lines:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Đơn bán chưa có món.",
            )

        # Record stock before money. Any error in recipe/stock mapping aborts
        # the whole transaction, so paid sales can never exist without stock movements.
        for line in lines:
            record_sale_consumption(
                connection,
                source_id=str(order_id),
                source_line_id=str(int(line["id"])),
                movement_time=paid_at,
                sold_quantity=float(line["quantity"]),
                menu_item_option_id=(
                    int(line["menu_item_option_id"])
                    if line["menu_item_option_id"] is not None
                    else None
                ),
                menu_item_id=(
                    int(line["menu_item_id"])
                    if line["menu_item_id"] is not None
                    else None
                ),
            )

        payment_reference: str | None = None
        if actual_received > 0:
            category_id = get_sale_category_id(connection)
            payment_reference = next_receipt_reference(connection, paid_at)
            connection.execute(
                """
                INSERT INTO fund_transactions (
                    fund_account_id,
                    transaction_time,
                    transaction_type,
                    category_id,
                    direction,
                    amount,
                    source_type,
                    source_id,
                    reference_code,
                    description,
                    created_at,
                    is_void
                )
                VALUES (?, ?, 'NORMAL', ?, 'IN', ?, 'SALE', ?, ?, ?, CURRENT_TIMESTAMP, 0)
                """,
                (
                    payload.fund_account_id,
                    paid_at,
                    category_id,
                    actual_received,
                    str(order_id),
                    payment_reference,
                    f"Bán hàng {order['order_code']}",
                ),
            )
            connection.execute(
                """
                UPDATE fund_accounts
                SET current_balance = current_balance + ?
                WHERE id = ?
                """,
                (actual_received, payload.fund_account_id),
            )

        connection.execute(
            """
            UPDATE sales_orders
            SET status = 'PAID',
                fund_account_id = ?,
                actual_received_amount = ?,
                payment_reference_code = ?,
                paid_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                payload.fund_account_id,
                actual_received,
                payment_reference,
                paid_at,
                order_id,
            ),
        )
        connection.commit()

        row = select_order(connection, order_id)
        assert row is not None
        output = order_to_output(connection, row)

    backup_database(reason="sale-order-paid")
    return output


@router.post("/orders/{order_id}/void", response_model=SaleOrderOutput)
def void_order(
    order_id: int,
    reason: str | None = Query(default=None),
) -> SaleOrderOutput:
    voided_at = datetime.now().isoformat(timespec="microseconds")
    reason_clean = clean_text(reason) or "Hủy đơn bán"

    with connect() as connection:
        order = select_order(connection, order_id)
        if order is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy đơn bán.",
            )
        if order["status"] == "VOID":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Đơn bán đã được hủy.",
            )

        if order["status"] == "PAID":
            payment = connection.execute(
                """
                SELECT id, fund_account_id, amount
                FROM fund_transactions
                WHERE source_type = 'SALE'
                  AND source_id = ?
                  AND direction = 'IN'
                  AND is_void = 0
                ORDER BY id DESC
                LIMIT 1
                """,
                (str(order_id),),
            ).fetchone()
            if payment is not None:
                connection.execute(
                    "UPDATE fund_transactions SET is_void = 1 WHERE id = ?",
                    (int(payment["id"]),),
                )
                connection.execute(
                    """
                    UPDATE fund_accounts
                    SET current_balance = current_balance - ?
                    WHERE id = ?
                    """,
                    (int(payment["amount"]), int(payment["fund_account_id"])),
                )

            sale_movements = connection.execute(
                """
                SELECT item_id, quantity_delta, source_line_id
                FROM inventory_movements
                WHERE source_type = 'SALE'
                  AND source_id = ?
                ORDER BY id ASC
                """,
                (str(order_id),),
            ).fetchall()
            for movement in sale_movements:
                connection.execute(
                    """
                    INSERT INTO inventory_movements (
                        item_id,
                        movement_time,
                        quantity_delta,
                        source_type,
                        source_id,
                        source_line_id,
                        note,
                        created_at
                    )
                    VALUES (?, ?, ?, 'SALE_VOID', ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    (
                        int(movement["item_id"]),
                        voided_at,
                        -float(movement["quantity_delta"]),
                        str(order_id),
                        movement["source_line_id"],
                        f"Hủy bán hàng {order['order_code']}",
                    ),
                )

        connection.execute(
            """
            UPDATE sales_orders
            SET status = 'VOID',
                void_reason = ?,
                voided_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (reason_clean, voided_at, order_id),
        )
        connection.commit()

        row = select_order(connection, order_id)
        assert row is not None
        output = order_to_output(connection, row)

    backup_database(reason="sale-order-voided")
    return output
