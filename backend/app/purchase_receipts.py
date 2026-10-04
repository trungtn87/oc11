import sqlite3
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/purchase-receipts", tags=["purchase-receipts"])


class PurchaseReceiptItemInput(BaseModel):
    item_id: int
    unit_id: int
    quantity: float = Field(gt=0)
    unit_price: int = Field(ge=0)
    note: str | None = Field(default=None, max_length=300)


class PurchasePaymentInput(BaseModel):
    account_type: str
    fund_account_id: int


class PurchaseReceiptInput(BaseModel):
    supplier_id: int
    receipt_time: str
    description: str | None = Field(default=None, max_length=500)
    shipping_fee: int = Field(default=0, ge=0)
    payment_status: str
    payment: PurchasePaymentInput | None = None
    items: list[PurchaseReceiptItemInput] = Field(min_length=1)


class PurchaseReceiptItemOutput(BaseModel):
    id: int
    item_id: int
    item_name: str
    unit_id: int
    unit_name: str
    quantity: float
    conversion_factor: float
    quantity_in_smallest_unit: float
    smallest_unit_name: str
    unit_price: int
    line_total: int
    note: str | None


class PurchaseReceiptOutput(BaseModel):
    id: int
    receipt_code: str
    supplier_id: int
    supplier_name: str
    receipt_time: str
    description: str | None
    goods_total: int
    shipping_fee: int
    total_amount: int
    payment_status: str
    payment_reference_code: str | None
    created_at: str
    items: list[PurchaseReceiptItemOutput] = []


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def normalize_payment_status(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in {"PAID", "DEBT"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Trạng thái thanh toán không hợp lệ.",
        )
    return normalized


def parse_datetime(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày nhập không hợp lệ.",
        )


def next_receipt_code(connection: sqlite3.Connection) -> str:
    row = connection.execute(
        "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM purchase_receipts"
    ).fetchone()
    return f"NK{int(row['next_id']):06d}"


def ensure_supplier(connection: sqlite3.Connection, supplier_id: int) -> sqlite3.Row:
    row = connection.execute(
        "SELECT id, name FROM suppliers WHERE id = ?",
        (supplier_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy nhà cung cấp.",
        )
    return row


def get_item_and_conversion(
    connection: sqlite3.Connection,
    item_id: int,
    unit_id: int,
) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT
            i.id,
            i.name,
            i.is_active,
            i.smallest_unit_id,
            su.name AS smallest_unit_name,
            c.unit_id,
            u.name AS unit_name,
            c.quantity_in_smallest_unit,
            c.is_active AS conversion_active
        FROM items AS i
        JOIN units AS su ON su.id = i.smallest_unit_id
        JOIN item_unit_conversions AS c ON c.item_id = i.id
        JOIN units AS u ON u.id = c.unit_id
        WHERE i.id = ? AND c.unit_id = ?
        """,
        (item_id, unit_id),
    ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Đơn vị nhập chưa có quy đổi cho hàng hóa.",
        )
    if not bool(row["is_active"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Hàng hóa {row['name']} đang ngừng sử dụng.",
        )
    if not bool(row["conversion_active"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Đơn vị {row['unit_name']} đang ngừng sử dụng cho {row['name']}.",
        )
    return row


def get_or_create_supplier_payment_category(connection: sqlite3.Connection) -> int:
    row = connection.execute(
        """
        SELECT id
        FROM fund_transaction_categories
        WHERE name = ? COLLATE NOCASE AND direction = 'OUT'
        """,
        ("Thanh toán nhà cung cấp",),
    ).fetchone()
    if row is not None:
        return int(row["id"])

    cursor = connection.execute(
        """
        INSERT INTO fund_transaction_categories (
            name, direction, is_active, sort_order
        )
        VALUES (?, 'OUT', 1, 0)
        """,
        ("Thanh toán nhà cung cấp",),
    )
    return int(cursor.lastrowid)


def next_payment_reference(
    connection: sqlite3.Connection,
    transaction_time: str,
) -> str:
    dt = parse_datetime(transaction_time)
    prefix = "PC"
    day_key = dt.strftime("%Y%m%d")
    pattern = f"{prefix}-{day_key}-%"
    row = connection.execute(
        "SELECT COUNT(*) AS total FROM fund_transactions WHERE reference_code LIKE ?",
        (pattern,),
    ).fetchone()
    return f"{prefix}-{day_key}-{int(row['total']) + 1:03d}"


def create_payment_transaction(
    connection: sqlite3.Connection,
    *,
    receipt_id: int,
    receipt_code: str,
    supplier_name: str,
    total_amount: int,
    transaction_time: str,
    account_type: str,
    fund_account_id: int,
) -> str:
    normalized_type = account_type.strip().upper()
    if normalized_type not in {"CASH", "BANK"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loại tiền không hợp lệ.",
        )

    account = connection.execute(
        """
        SELECT id, type, current_balance, is_active
        FROM fund_accounts
        WHERE id = ?
        """,
        (fund_account_id,),
    ).fetchone()
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy quỹ/tài khoản.",
        )
    if account["type"] != normalized_type:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Quỹ/tài khoản không đúng loại tiền.",
        )
    if not bool(account["is_active"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Quỹ/tài khoản đang ngừng sử dụng.",
        )
    if int(account["current_balance"]) < total_amount:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Số dư quỹ/tài khoản không đủ.",
        )

    category_id = get_or_create_supplier_payment_category(connection)
    reference_code = next_payment_reference(connection, transaction_time)
    description = f"Thanh toán phiếu nhập {receipt_code} - {supplier_name}"

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
        VALUES (?, ?, 'NORMAL', ?, 'OUT', ?, 'PURCHASE_RECEIPT', ?, ?, ?, CURRENT_TIMESTAMP, 0)
        """,
        (
            fund_account_id,
            transaction_time,
            category_id,
            total_amount,
            str(receipt_id),
            reference_code,
            description,
        ),
    )
    connection.execute(
        """
        UPDATE fund_accounts
        SET current_balance = current_balance - ?
        WHERE id = ?
        """,
        (total_amount, fund_account_id),
    )
    return reference_code


def select_receipt(connection: sqlite3.Connection, receipt_id: int) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            r.id,
            r.receipt_code,
            r.supplier_id,
            s.name AS supplier_name,
            r.receipt_time,
            r.description,
            r.goods_total,
            r.shipping_fee,
            r.total_amount,
            r.payment_status,
            r.payment_reference_code,
            r.created_at
        FROM purchase_receipts AS r
        JOIN suppliers AS s ON s.id = r.supplier_id
        WHERE r.id = ?
        """,
        (receipt_id,),
    ).fetchone()


def select_receipt_items(
    connection: sqlite3.Connection,
    receipt_id: int,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT
            pri.id,
            pri.item_id,
            i.name AS item_name,
            pri.unit_id,
            u.name AS unit_name,
            pri.quantity,
            pri.conversion_factor,
            pri.quantity_in_smallest_unit,
            su.name AS smallest_unit_name,
            pri.unit_price,
            pri.line_total,
            pri.note
        FROM purchase_receipt_items AS pri
        JOIN items AS i ON i.id = pri.item_id
        JOIN units AS u ON u.id = pri.unit_id
        JOIN units AS su ON su.id = i.smallest_unit_id
        WHERE pri.purchase_receipt_id = ?
        ORDER BY pri.id
        """,
        (receipt_id,),
    ).fetchall()


def row_to_output(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    include_items: bool = True,
) -> PurchaseReceiptOutput:
    items: list[PurchaseReceiptItemOutput] = []
    if include_items:
        items = [
            PurchaseReceiptItemOutput(
                id=item["id"],
                item_id=item["item_id"],
                item_name=item["item_name"],
                unit_id=item["unit_id"],
                unit_name=item["unit_name"],
                quantity=item["quantity"],
                conversion_factor=item["conversion_factor"],
                quantity_in_smallest_unit=item["quantity_in_smallest_unit"],
                smallest_unit_name=item["smallest_unit_name"],
                unit_price=item["unit_price"],
                line_total=item["line_total"],
                note=item["note"],
            )
            for item in select_receipt_items(connection, row["id"])
        ]

    return PurchaseReceiptOutput(
        id=row["id"],
        receipt_code=row["receipt_code"],
        supplier_id=row["supplier_id"],
        supplier_name=row["supplier_name"],
        receipt_time=row["receipt_time"],
        description=row["description"],
        goods_total=row["goods_total"],
        shipping_fee=row["shipping_fee"],
        total_amount=row["total_amount"],
        payment_status=row["payment_status"],
        payment_reference_code=row["payment_reference_code"],
        created_at=row["created_at"],
        items=items,
    )


@router.get("", response_model=list[PurchaseReceiptOutput])
def list_purchase_receipts(
    supplier_id: int | None = Query(default=None),
    payment_status: str | None = Query(default=None),
    search: str | None = Query(default=None),
) -> list[PurchaseReceiptOutput]:
    conditions: list[str] = []
    params: list[object] = []

    if supplier_id is not None:
        conditions.append("r.supplier_id = ?")
        params.append(supplier_id)

    if payment_status:
        conditions.append("r.payment_status = ?")
        params.append(normalize_payment_status(payment_status))

    if search and search.strip():
        keyword = f"%{search.strip()}%"
        conditions.append(
            "(r.receipt_code LIKE ? OR s.name LIKE ? OR COALESCE(r.description, '') LIKE ?)"
        )
        params.extend([keyword, keyword, keyword])

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with connect() as connection:
        rows = connection.execute(
            f"""
            SELECT
                r.id,
                r.receipt_code,
                r.supplier_id,
                s.name AS supplier_name,
                r.receipt_time,
                r.description,
                r.goods_total,
                r.shipping_fee,
                r.total_amount,
                r.payment_status,
                r.payment_reference_code,
                r.created_at
            FROM purchase_receipts AS r
            JOIN suppliers AS s ON s.id = r.supplier_id
            {where}
            ORDER BY r.receipt_time DESC, r.id DESC
            """,
            tuple(params),
        ).fetchall()
        return [row_to_output(connection, row, include_items=False) for row in rows]


@router.get("/{receipt_id}", response_model=PurchaseReceiptOutput)
def get_purchase_receipt(receipt_id: int) -> PurchaseReceiptOutput:
    with connect() as connection:
        row = select_receipt(connection, receipt_id)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy phiếu nhập.",
            )
        return row_to_output(connection, row)


@router.post(
    "",
    response_model=PurchaseReceiptOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_purchase_receipt(payload: PurchaseReceiptInput) -> PurchaseReceiptOutput:
    payment_status = normalize_payment_status(payload.payment_status)
    parse_datetime(payload.receipt_time)

    if payment_status == "PAID" and payload.payment is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Phiếu đã thanh toán cần chọn loại tiền và quỹ/tài khoản.",
        )

    with connect() as connection:
        supplier = ensure_supplier(connection, payload.supplier_id)
        prepared_items: list[tuple[PurchaseReceiptItemInput, sqlite3.Row, int, float]] = []
        goods_total = 0

        for line in payload.items:
            item = get_item_and_conversion(
                connection,
                line.item_id,
                line.unit_id,
            )
            line_total = int(round(line.quantity * line.unit_price))
            quantity_in_smallest = (
                line.quantity * float(item["quantity_in_smallest_unit"])
            )
            goods_total += line_total
            prepared_items.append((line, item, line_total, quantity_in_smallest))

        total_amount = goods_total + payload.shipping_fee
        receipt_code = next_receipt_code(connection)
        cursor = connection.execute(
            """
            INSERT INTO purchase_receipts (
                receipt_code,
                supplier_id,
                receipt_time,
                description,
                goods_total,
                shipping_fee,
                total_amount,
                payment_status,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                receipt_code,
                payload.supplier_id,
                payload.receipt_time,
                clean_text(payload.description),
                goods_total,
                payload.shipping_fee,
                total_amount,
                payment_status,
            ),
        )
        receipt_id = int(cursor.lastrowid)

        for line, item, line_total, quantity_in_smallest in prepared_items:
            item_cursor = connection.execute(
                """
                INSERT INTO purchase_receipt_items (
                    purchase_receipt_id,
                    item_id,
                    unit_id,
                    quantity,
                    conversion_factor,
                    quantity_in_smallest_unit,
                    unit_price,
                    line_total,
                    note
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    receipt_id,
                    line.item_id,
                    line.unit_id,
                    line.quantity,
                    float(item["quantity_in_smallest_unit"]),
                    quantity_in_smallest,
                    line.unit_price,
                    line_total,
                    clean_text(line.note),
                ),
            )
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
                VALUES (?, ?, ?, 'PURCHASE_RECEIPT', ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    line.item_id,
                    payload.receipt_time,
                    quantity_in_smallest,
                    str(receipt_id),
                    str(int(item_cursor.lastrowid)),
                    f"Nhập hàng {receipt_code}",
                ),
            )

        if payment_status == "PAID" and payload.payment is not None:
            payment_reference = create_payment_transaction(
                connection,
                receipt_id=receipt_id,
                receipt_code=receipt_code,
                supplier_name=supplier["name"],
                total_amount=total_amount,
                transaction_time=payload.receipt_time,
                account_type=payload.payment.account_type,
                fund_account_id=payload.payment.fund_account_id,
            )
            connection.execute(
                """
                UPDATE purchase_receipts
                SET payment_reference_code = ?
                WHERE id = ?
                """,
                (payment_reference, receipt_id),
            )

        connection.commit()

        row = select_receipt(connection, receipt_id)
        assert row is not None
        output = row_to_output(connection, row)

    backup_database(reason="purchase-receipt-created")
    return output
