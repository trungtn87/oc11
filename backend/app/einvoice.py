"""Safe electronic-invoice handoff for OC11.

No endpoint in this module publishes invoices. CUKCUK remains the sole real issuer
until the owner has tested the MISA sandbox, verified taxes and approved cutover.
Credentials and bearer tokens must never be sent to this local unauthenticated API.
"""
import sqlite3
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/einvoice", tags=["einvoice"])


class EinvoiceSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    environment: Literal["SANDBOX", "PRODUCTION"] = "SANDBOX"
    company_tax_code: str = Field(default="", max_length=32)
    invoice_series: str = Field(default="", max_length=32)


def _settings(connection: sqlite3.Connection) -> dict:
    row = connection.execute(
        "SELECT environment, company_tax_code, invoice_series "
        "FROM einvoice_integration_settings WHERE id = 1"
    ).fetchone()
    assert row is not None
    return {
        "provider": "MISA_MEINVOICE",
        "issuance_source": "CUKCUK",
        "environment": row["environment"],
        "company_tax_code": row["company_tax_code"],
        "invoice_series": row["invoice_series"],
        "live_enabled": False,
        "sandbox_publish_enabled": False,
        "credential_storage": "NOT_CONFIGURED",
        "message": (
            "CUKCUK tiếp tục phát hành hóa đơn thật. "
            "POS Ốc 11 chỉ chuẩn bị yêu cầu, không gửi hóa đơn đến MISA."
        ),
    }


@router.get("/settings")
def read_settings() -> dict:
    with connect() as connection:
        return _settings(connection)


@router.put("/settings")
def update_settings(payload: EinvoiceSettingsInput) -> dict:
    tax_code = payload.company_tax_code.strip()
    series = payload.invoice_series.strip()
    with connect() as connection:
        connection.execute(
            """
            UPDATE einvoice_integration_settings
            SET environment = ?, company_tax_code = ?, invoice_series = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
            """,
            (payload.environment, tax_code, series),
        )
        result = _settings(connection)
    backup_database(reason="einvoice-settings-updated")
    return result


@router.get("/orders")
def list_invoice_orders() -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT so.id AS sales_order_id, so.order_code, so.order_time,
                   so.total_amount, so.status AS sale_status,
                   so.settlement_status, c.name AS customer_name,
                   c.tax_code AS customer_tax_code, ei.id AS invoice_id,
                   ei.status AS invoice_status, ei.invoice_series,
                   ei.invoice_number, ei.issued_at, ei.created_at AS requested_at
            FROM sales_orders AS so
            LEFT JOIN customers AS c ON c.id = so.customer_id
            LEFT JOIN electronic_invoices AS ei ON ei.id = (
                SELECT id FROM electronic_invoices
                WHERE sales_order_id = so.id ORDER BY id DESC LIMIT 1
            )
            WHERE so.status = 'PAID'
            ORDER BY COALESCE(so.paid_at, so.order_time) DESC, so.id DESC
            LIMIT 500
            """
        ).fetchall()
    return [
        {
            **dict(row),
            "invoice_status": row["invoice_status"] or "NOT_REQUESTED",
        }
        for row in rows
    ]


def _load_order(connection: sqlite3.Connection, order_id: int) -> sqlite3.Row:
    order = connection.execute(
        """
        SELECT so.*, c.name AS customer_name, c.customer_type,
               c.tax_code AS customer_tax_code, c.address AS customer_address,
               c.email AS customer_email, c.contact_name AS customer_contact
        FROM sales_orders AS so
        LEFT JOIN customers AS c ON c.id = so.customer_id
        WHERE so.id = ?
        """,
        (order_id,),
    ).fetchone()
    if order is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn bán.")
    return order


@router.get("/orders/{order_id}/preview")
def preview_invoice(order_id: int) -> dict:
    with connect() as connection:
        order = _load_order(connection, order_id)
        details = connection.execute(
            """
            SELECT soi.id, soi.item_name_snapshot, soi.option_name_snapshot,
                   soi.unit_name_snapshot, soi.quantity, soi.unit_price,
                   soi.line_total,
                   COALESCE((
                       SELECT SUM(s.amount) FROM sales_order_item_surcharges s
                       WHERE s.sales_order_item_id = soi.id
                   ), 0) AS surcharge_total
            FROM sales_order_items soi WHERE soi.sales_order_id = ?
            ORDER BY soi.id
            """,
            (order_id,),
        ).fetchall()
        order_surcharges = connection.execute(
            """
            SELECT name, amount
            FROM sales_order_surcharges
            WHERE sales_order_id = ? ORDER BY id
            """,
            (order_id,),
        ).fetchall()
        invoice = connection.execute(
            """
            SELECT id, status, invoice_series, invoice_number, external_id, issued_at
            FROM electronic_invoices
            WHERE sales_order_id = ? ORDER BY id DESC LIMIT 1
            """,
            (order_id,),
        ).fetchone()
        settings = _settings(connection)

    warnings = [
        "Chưa cấu hình thuế suất theo từng món/phụ thu nên không thể lập dữ liệu thuế MISA.",
        "Cần đối chiếu các HĐĐT CUKCUK đã phát hành trước khi chuyển hệ thống.",
    ]
    if not order["customer_id"]:
        warnings.append("Đơn chưa chọn thông tin khách hàng xuất hóa đơn.")
    if order["status"] != "PAID":
        warnings.append("Đơn chưa chốt thanh toán/ghi nợ.")
    if not settings["company_tax_code"] or not settings["invoice_series"]:
        warnings.append("Chưa khai báo đầy đủ MST người bán và ký hiệu hóa đơn.")

    return {
        "sales_order_id": order["id"],
        "order_code": order["order_code"],
        "order_time": order["order_time"],
        "sale_status": order["status"],
        "settlement_status": order["settlement_status"],
        "total_amount": order["total_amount"],
        "customer": {
            "id": order["customer_id"],
            "name": order["customer_name"],
            "type": order["customer_type"],
            "tax_code": order["customer_tax_code"],
            "address": order["customer_address"],
            "email": order["customer_email"],
            "contact_name": order["customer_contact"],
        },
        "items": [dict(row) for row in details],
        "order_surcharges": [dict(row) for row in order_surcharges],
        "invoice": dict(invoice) if invoice else None,
        "settings": settings,
        "can_publish": False,
        "warnings": warnings,
    }


@router.post("/orders/{order_id}/request", status_code=status.HTTP_201_CREATED)
def request_invoice(order_id: int) -> dict:
    """Create exactly one local DRAFT; does not contact MISA or CUKCUK."""
    with connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        order = _load_order(connection, order_id)
        if order["status"] != "PAID":
            raise HTTPException(status_code=409, detail="Chỉ lập yêu cầu cho đơn đã chốt.")
        if order["customer_id"] is None:
            raise HTTPException(status_code=422, detail="Cần chọn khách hàng trước khi lập HĐĐT.")
        existing = connection.execute(
            "SELECT id, status FROM electronic_invoices WHERE sales_order_id = ? LIMIT 1",
            (order_id,),
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail="Đơn đã có yêu cầu hoặc hóa đơn điện tử; không thể tạo trùng.",
            )
        cursor = connection.execute(
            "INSERT INTO electronic_invoices (sales_order_id, status) VALUES (?, 'DRAFT')",
            (order_id,),
        )
        invoice_id = cursor.lastrowid
    backup_database(reason="einvoice-draft-created")
    return {
        "id": invoice_id,
        "sales_order_id": order_id,
        "status": "DRAFT",
        "sent_to_misa": False,
    }
