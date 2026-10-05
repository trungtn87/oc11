import sqlite3
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .cost_recipes import refresh_cost_alerts_for_items
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
    client_sync_id: str | None = Field(default=None, max_length=80)
    supplier_id: int
    receipt_time: str
    description: str | None = Field(default=None, max_length=500)
    shipping_fee: int = Field(default=0, ge=0)
    payment_status: str
    payment: PurchasePaymentInput | None = None
    replaces_receipt_id: int | None = None
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
    payment_fund_account_id: int | None
    payment_account_type: str | None
    replaces_receipt_id: int | None
    replaces_receipt_code: str | None
    replacement_receipt_id: int | None
    replacement_receipt_code: str | None
    is_void: bool
    voided_at: str | None
    created_at: str
    updated_at: str | None
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


def prepare_items(
    connection: sqlite3.Connection,
    lines: list[PurchaseReceiptItemInput],
) -> tuple[list[tuple[PurchaseReceiptItemInput, sqlite3.Row, int, float]], int]:
    prepared: list[tuple[PurchaseReceiptItemInput, sqlite3.Row, int, float]] = []
    goods_total = 0

    for line in lines:
        item = get_item_and_conversion(connection, line.item_id, line.unit_id)
        line_total = int(round(line.quantity * line.unit_price))
        quantity_in_smallest = (
            line.quantity * float(item["quantity_in_smallest_unit"])
        )
        goods_total += line_total
        prepared.append((line, item, line_total, quantity_in_smallest))

    return prepared, goods_total


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
    day_key = dt.strftime("%Y%m%d")
    pattern = f"PC-{day_key}-%"
    row = connection.execute(
        "SELECT COUNT(*) AS total FROM fund_transactions WHERE reference_code LIKE ?",
        (pattern,),
    ).fetchone()
    return f"PC-{day_key}-{int(row['total']) + 1:03d}"


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


def insert_receipt_lines(
    connection: sqlite3.Connection,
    *,
    receipt_id: int,
    receipt_code: str,
    receipt_time: str,
    prepared_items: list[
        tuple[PurchaseReceiptItemInput, sqlite3.Row, int, float]
    ],
) -> None:
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
                receipt_time,
                quantity_in_smallest,
                str(receipt_id),
                str(int(item_cursor.lastrowid)),
                f"Nhập hàng {receipt_code}",
            ),
        )


def select_receipt(
    connection: sqlite3.Connection,
    receipt_id: int,
) -> sqlite3.Row | None:
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
            r.replaces_receipt_id,
            r.is_void,
            r.voided_at,
            r.created_at,
            r.updated_at
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


def select_payment_info(
    connection: sqlite3.Connection,
    receipt_id: int,
    payment_reference_code: str | None,
) -> sqlite3.Row | None:
    if payment_reference_code:
        row = connection.execute(
            """
            SELECT
                ft.fund_account_id,
                fa.type AS account_type
            FROM fund_transactions AS ft
            JOIN fund_accounts AS fa ON fa.id = ft.fund_account_id
            WHERE ft.reference_code = ?
              AND ft.direction = 'OUT'
            ORDER BY ft.id DESC
            LIMIT 1
            """,
            (payment_reference_code,),
        ).fetchone()
        if row is not None:
            return row

    return connection.execute(
        """
        SELECT
            ft.fund_account_id,
            fa.type AS account_type
        FROM fund_transactions AS ft
        JOIN fund_accounts AS fa ON fa.id = ft.fund_account_id
        WHERE ft.source_type = 'PURCHASE_RECEIPT'
          AND ft.source_id = ?
          AND ft.direction = 'OUT'
        ORDER BY ft.id DESC
        LIMIT 1
        """,
        (str(receipt_id),),
    ).fetchone()


def select_receipt_link(
    connection: sqlite3.Connection,
    receipt_id: int | None,
) -> sqlite3.Row | None:
    if receipt_id is None:
        return None
    return connection.execute(
        "SELECT id, receipt_code FROM purchase_receipts WHERE id = ?",
        (receipt_id,),
    ).fetchone()


def select_active_replacement(
    connection: sqlite3.Connection,
    receipt_id: int,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT id, receipt_code
        FROM purchase_receipts
        WHERE replaces_receipt_id = ?
          AND is_void = 0
        ORDER BY id DESC
        LIMIT 1
        """,
        (receipt_id,),
    ).fetchone()


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

    payment = select_payment_info(
        connection,
        row["id"],
        row["payment_reference_code"],
    )
    replaces = select_receipt_link(connection, row["replaces_receipt_id"])
    replacement = select_active_replacement(connection, row["id"])

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
        payment_fund_account_id=payment["fund_account_id"] if payment else None,
        payment_account_type=payment["account_type"] if payment else None,
        replaces_receipt_id=row["replaces_receipt_id"],
        replaces_receipt_code=replaces["receipt_code"] if replaces else None,
        replacement_receipt_id=replacement["id"] if replacement else None,
        replacement_receipt_code=replacement["receipt_code"] if replacement else None,
        is_void=bool(row["is_void"]),
        voided_at=row["voided_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        items=items,
    )


def validate_replacement(
    connection: sqlite3.Connection,
    replaces_receipt_id: int | None,
) -> None:
    if replaces_receipt_id is None:
        return

    old = select_receipt(connection, replaces_receipt_id)
    if old is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy phiếu nhập cần thay thế.",
        )
    if not bool(old["is_void"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Chỉ được nhập lại từ phiếu đã hủy.",
        )

    replacement = select_active_replacement(connection, replaces_receipt_id)
    if replacement is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Phiếu này đã được thay thế bởi {replacement['receipt_code']}.",
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
                r.replaces_receipt_id,
                r.is_void,
                r.voided_at,
                r.created_at,
                r.updated_at
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
    if payment_status == "DEBT" and payload.payment is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Phiếu trả nợ chưa được chọn quỹ/tài khoản thanh toán.",
        )

    with connect() as connection:
        if payload.client_sync_id:
            existing_sync = connection.execute(
                """
                SELECT id
                FROM purchase_receipts
                WHERE client_sync_id = ?
                LIMIT 1
                """,
                (payload.client_sync_id.strip(),),
            ).fetchone()
            if existing_sync is not None:
                existing_row = select_receipt(connection, int(existing_sync["id"]))
                assert existing_row is not None
                return row_to_output(connection, existing_row)

        validate_replacement(connection, payload.replaces_receipt_id)
        supplier = ensure_supplier(connection, payload.supplier_id)
        prepared_items, goods_total = prepare_items(connection, payload.items)
        total_amount = goods_total + payload.shipping_fee
        receipt_code = next_receipt_code(connection)

        cursor = connection.execute(
            """
            INSERT INTO purchase_receipts (
                receipt_code,
                client_sync_id,
                supplier_id,
                receipt_time,
                description,
                goods_total,
                shipping_fee,
                total_amount,
                payment_status,
                replaces_receipt_id,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                receipt_code,
                payload.client_sync_id.strip() if payload.client_sync_id else None,
                payload.supplier_id,
                payload.receipt_time,
                clean_text(payload.description),
                goods_total,
                payload.shipping_fee,
                total_amount,
                payment_status,
                payload.replaces_receipt_id,
            ),
        )
        receipt_id = int(cursor.lastrowid)

        insert_receipt_lines(
            connection,
            receipt_id=receipt_id,
            receipt_code=receipt_code,
            receipt_time=payload.receipt_time,
            prepared_items=prepared_items,
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
                SET payment_reference_code = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (payment_reference, receipt_id),
            )

        connection.commit()
        row = select_receipt(connection, receipt_id)
        assert row is not None
        output = row_to_output(connection, row)

    refresh_cost_alerts_for_items([line.item_id for line in payload.items])
    backup_database(reason="purchase-receipt-created")
    return output


@router.put("/{receipt_id}", response_model=PurchaseReceiptOutput)
def update_purchase_receipt(
    receipt_id: int,
    payload: PurchaseReceiptInput,
) -> PurchaseReceiptOutput:
    payment_status = normalize_payment_status(payload.payment_status)
    parse_datetime(payload.receipt_time)

    if payment_status != "DEBT":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Phiếu trả nợ chỉ được sửa khi vẫn ở trạng thái Trả nợ. Dùng chức năng Trả nợ để thanh toán.",
        )
    if payload.payment is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Phiếu trả nợ chưa được chọn quỹ/tài khoản thanh toán.",
        )

    with connect() as connection:
        existing = select_receipt(connection, receipt_id)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy phiếu nhập.",
            )
        if bool(existing["is_void"]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Phiếu đã hủy không thể sửa.",
            )
        if existing["payment_status"] != "DEBT":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Phiếu đã thanh toán không được sửa. Hãy dùng Hủy để nhập lại.",
            )

        ensure_supplier(connection, payload.supplier_id)
        prepared_items, goods_total = prepare_items(connection, payload.items)
        total_amount = goods_total + payload.shipping_fee

        connection.execute(
            """
            DELETE FROM inventory_movements
            WHERE source_type = 'PURCHASE_RECEIPT'
              AND source_id = ?
            """,
            (str(receipt_id),),
        )
        connection.execute(
            "DELETE FROM purchase_receipt_items WHERE purchase_receipt_id = ?",
            (receipt_id,),
        )
        connection.execute(
            """
            UPDATE purchase_receipts
            SET supplier_id = ?,
                receipt_time = ?,
                description = ?,
                goods_total = ?,
                shipping_fee = ?,
                total_amount = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                payload.supplier_id,
                payload.receipt_time,
                clean_text(payload.description),
                goods_total,
                payload.shipping_fee,
                total_amount,
                receipt_id,
            ),
        )
        insert_receipt_lines(
            connection,
            receipt_id=receipt_id,
            receipt_code=existing["receipt_code"],
            receipt_time=payload.receipt_time,
            prepared_items=prepared_items,
        )
        connection.commit()

        row = select_receipt(connection, receipt_id)
        assert row is not None
        output = row_to_output(connection, row)

    refresh_cost_alerts_for_items([line.item_id for line in payload.items])
    backup_database(reason="purchase-receipt-updated")
    return output


@router.post(
    "/{receipt_id}/void-for-reentry",
    response_model=PurchaseReceiptOutput,
)
def void_purchase_receipt_for_reentry(
    receipt_id: int,
) -> PurchaseReceiptOutput:
    with connect() as connection:
        receipt = select_receipt(connection, receipt_id)
        if receipt is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy phiếu nhập.",
            )
        if bool(receipt["is_void"]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Phiếu nhập đã được hủy trước đó.",
            )
        if receipt["payment_status"] != "PAID":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Chỉ phiếu đã thanh toán mới dùng Hủy để nhập lại.",
            )

        payment = connection.execute(
            """
            SELECT
                ft.id,
                ft.fund_account_id,
                ft.amount,
                ft.reference_code
            FROM fund_transactions AS ft
            WHERE ft.direction = 'OUT'
              AND ft.is_void = 0
              AND (
                    (ft.source_type = 'PURCHASE_RECEIPT' AND ft.source_id = ?)
                    OR (? IS NOT NULL AND ft.reference_code = ?)
                  )
            ORDER BY ft.id DESC
            LIMIT 1
            """,
            (
                str(receipt_id),
                receipt["payment_reference_code"],
                receipt["payment_reference_code"],
            ),
        ).fetchone()

        if payment is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Không tìm thấy phiếu chi liên quan nên chưa thể hủy phiếu nhập an toàn.",
            )
        if int(payment["amount"]) != int(receipt["total_amount"]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Số tiền phiếu chi không khớp phiếu nhập. Cần kiểm tra trước khi hủy.",
            )

        connection.execute(
            """
            UPDATE fund_accounts
            SET current_balance = current_balance + ?
            WHERE id = ?
            """,
            (payment["amount"], payment["fund_account_id"]),
        )
        connection.execute(
            "UPDATE fund_transactions SET is_void = 1 WHERE id = ?",
            (payment["id"],),
        )

        void_time = datetime.now().isoformat(timespec="microseconds")
        receipt_items = select_receipt_items(connection, receipt_id)
        affected_item_ids = [int(item["item_id"]) for item in receipt_items]
        for item in receipt_items:
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
                VALUES (?, ?, ?, 'PURCHASE_RECEIPT_VOID', ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    item["item_id"],
                    void_time,
                    -float(item["quantity_in_smallest_unit"]),
                    str(receipt_id),
                    str(item["id"]),
                    f"Hủy để nhập lại {receipt['receipt_code']}",
                ),
            )

        connection.execute(
            """
            UPDATE purchase_receipts
            SET is_void = 1,
                voided_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (void_time, receipt_id),
        )
        connection.commit()

        row = select_receipt(connection, receipt_id)
        assert row is not None
        output = row_to_output(connection, row)

    refresh_cost_alerts_for_items(affected_item_ids)
    backup_database(reason="purchase-receipt-voided")
    return output
