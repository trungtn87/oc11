import json
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect
from .pos_printing import unsent_items
from .pos_templates import (
    PrintTemplate, TemplateKind, TemplatePreviewInput, default_template,
    get_templates, put_template, render_kitchen_template, render_money_template,
    sample_print, with_print_style,
)
from .sales import select_item_surcharges, select_order, select_order_items, select_order_surcharges
from .settings import load_settings, save_settings


router = APIRouter(prefix="/api/pos", tags=["pos"])


class PosCustomerInput(BaseModel):
    customer_type: Literal["PERSON", "ORGANIZATION"] = "PERSON"
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    tax_code: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=500)
    email: str | None = Field(default=None, max_length=200)
    contact_name: str | None = Field(default=None, max_length=200)


@router.get("/customers")
def search_pos_customers(q: str = Query(default="", max_length=120)) -> list[dict]:
    with connect() as connection:
        like = "%" + q.strip().replace("%", "\\%").replace("_", "\\_") + "%"
        rows = connection.execute(
            """
            SELECT id, customer_code, customer_type, name, phone, tax_code,
                   address, email, contact_name
            FROM customers
            WHERE is_active = 1
              AND (name LIKE ? ESCAPE '\\'
                OR COALESCE(phone, '') LIKE ? ESCAPE '\\'
                OR COALESCE(tax_code, '') LIKE ? ESCAPE '\\')
            ORDER BY name, id LIMIT 50
            """,
            (like, like, like),
        ).fetchall()
        return [dict(row) for row in rows]


@router.post("/customers", status_code=status.HTTP_201_CREATED)
def create_pos_customer(payload: PosCustomerInput) -> dict:
    name = payload.name.strip()
    tax_code = (payload.tax_code or "").strip() or None
    address = (payload.address or "").strip() or None
    if not name:
        raise HTTPException(status_code=422, detail="Nhập tên khách hàng.")
    if tax_code and not address:
        raise HTTPException(status_code=422, detail="Có mã số thuế cần nhập địa chỉ.")
    with connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if tax_code and connection.execute(
            "SELECT id FROM customers WHERE tax_code = ?", (tax_code,)
        ).fetchone():
            raise HTTPException(status_code=409, detail="Mã số thuế đã có trong danh sách.")
        next_id = connection.execute(
            "SELECT COALESCE(MAX(id), 0) + 1 FROM customers"
        ).fetchone()[0]
        code = f"KH{next_id:06d}"
        connection.execute(
            """
            INSERT INTO customers (
                customer_code, customer_type, name, phone, tax_code,
                address, email, contact_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                code, payload.customer_type, name,
                (payload.phone or "").strip() or None, tax_code, address,
                (payload.email or "").strip() or None,
                (payload.contact_name or "").strip() or None,
            ),
        )
        row = connection.execute(
            """SELECT id, customer_code, customer_type, name, phone, tax_code,
                      address, email, contact_name FROM customers
               WHERE customer_code = ?""", (code,)
        ).fetchone()
        connection.commit()
        result = dict(row)
    backup_database(reason="pos-customer-created")
    return result


class AreaInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    display_order: int = 0
    is_active: bool = True


class AreaOutput(AreaInput):
    id: int


class RestaurantTableInput(BaseModel):
    area_id: int
    name: str = Field(min_length=1, max_length=80)
    seats: int = Field(default=0, ge=0, le=100)
    display_order: int = 0
    pos_x: float = 0
    pos_y: float = 0
    is_active: bool = True


class BulkTableCreateInput(BaseModel):
    area_id: int
    quantity: int = Field(ge=1, le=30)


class RestaurantTableOutput(RestaurantTableInput):
    id: int
    area_name: str
    open_order_id: int | None = None
    open_order_code: str | None = None
    open_order_total: int | None = None
    open_order_time: str | None = None
    guest_count: int = 0


PrinterTarget = Literal["KITCHEN", "CASHIER", "BOTH"]


class PosSettingsInput(BaseModel):
    kitchen_printer_name: str | None = Field(default="", max_length=300)
    cashier_printer_name: str | None = Field(default="", max_length=300)
    send_kitchen_targets: PrinterTarget = "BOTH"
    # Older clients may omit this field; keep the existing saved selection.
    print_receipt_targets: PrinterTarget | None = None


class PosSettingsOutput(BaseModel):
    kitchen_printer_name: str
    cashier_printer_name: str
    send_kitchen_targets: PrinterTarget
    print_receipt_targets: PrinterTarget


class PrintDestinationResult(BaseModel):
    role: Literal["KITCHEN", "CASHIER"]
    printer_name: str | None
    ok: bool
    error: str | None = None


class KitchenSendInput(BaseModel):
    # Print-only: never write to orders, kitchen ticket JSON, logs or settings.
    temporary_note: str = Field(default="", max_length=500)


class PrintDispatchOutput(BaseModel):
    order_id: int
    order_code: str
    print_status: Literal["PRINTED", "FAILED"]
    error_message: str | None
    printer_results: list[PrintDestinationResult]


class KitchenSendOutput(PrintDispatchOutput):
    print_status: Literal["PRINTED", "FAILED", "NO_NEW_ITEMS"]
    ticket_id: int | None
    sent_at: str | None
    printer_name: str | None


def clean_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên không được để trống.",
        )
    return value


def area_row_to_output(row) -> AreaOutput:
    return AreaOutput(
        id=int(row["id"]),
        name=row["name"],
        display_order=int(row["display_order"]),
        is_active=bool(row["is_active"]),
    )


def table_row_to_output(row) -> RestaurantTableOutput:
    return RestaurantTableOutput(
        id=int(row["id"]),
        area_id=int(row["area_id"]),
        area_name=row["area_name"],
        name=row["name"],
        seats=int(row["seats"]),
        display_order=int(row["display_order"]),
        pos_x=float(row["pos_x"]),
        pos_y=float(row["pos_y"]),
        is_active=bool(row["is_active"]),
        open_order_id=(
            int(row["open_order_id"])
            if row["open_order_id"] is not None
            else None
        ),
        open_order_code=row["open_order_code"],
        open_order_total=(
            int(row["open_order_total"])
            if row["open_order_total"] is not None
            else None
        ),
        open_order_time=row["open_order_time"],
        guest_count=int(row["guest_count"] or 0),
    )


def select_table(connection, table_id: int):
    return connection.execute(
        """
        SELECT
            rt.id,
            rt.area_id,
            ra.name AS area_name,
            rt.name,
            rt.seats,
            rt.display_order,
            rt.pos_x,
            rt.pos_y,
            rt.is_active,
            so.id AS open_order_id,
            so.order_code AS open_order_code,
            so.total_amount AS open_order_total,
            so.order_time AS open_order_time,
            so.guest_count AS guest_count
        FROM restaurant_tables AS rt
        JOIN restaurant_areas AS ra ON ra.id = rt.area_id
        LEFT JOIN sales_orders AS so
          ON so.table_id = rt.id
         AND so.status = 'OPEN'
        WHERE rt.id = ?
        """,
        (table_id,),
    ).fetchone()


@router.get("/areas", response_model=list[AreaOutput])
def list_areas(active_only: bool = Query(default=False)) -> list[AreaOutput]:
    with connect() as connection:
        where = "WHERE is_active = 1" if active_only else ""
        rows = connection.execute(
            f"""
            SELECT id, name, display_order, is_active
            FROM restaurant_areas
            {where}
            ORDER BY display_order ASC, id ASC
            """
        ).fetchall()
        return [area_row_to_output(row) for row in rows]


@router.post("/areas", response_model=AreaOutput, status_code=status.HTTP_201_CREATED)
def create_area(payload: AreaInput) -> AreaOutput:
    name = clean_name(payload.name)
    with connect() as connection:
        try:
            cursor = connection.execute(
                """
                INSERT INTO restaurant_areas (
                    name, display_order, is_active, created_at, updated_at
                )
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                (name, payload.display_order, int(payload.is_active)),
            )
            connection.commit()
        except Exception as exc:
            if "UNIQUE" in str(exc).upper():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Tên khu vực đã tồn tại.",
                ) from exc
            raise
        row = connection.execute(
            "SELECT id, name, display_order, is_active FROM restaurant_areas WHERE id = ?",
            (int(cursor.lastrowid),),
        ).fetchone()
        assert row is not None
        result = area_row_to_output(row)
    backup_database(reason="pos-area-created")
    return result


@router.put("/areas/{area_id}", response_model=AreaOutput)
def update_area(area_id: int, payload: AreaInput) -> AreaOutput:
    name = clean_name(payload.name)
    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM restaurant_areas WHERE id = ?", (area_id,)
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy khu vực.")

        if not payload.is_active:
            occupied = connection.execute(
                """
                SELECT 1
                FROM sales_orders AS so
                JOIN restaurant_tables AS rt ON rt.id = so.table_id
                WHERE rt.area_id = ? AND so.status = 'OPEN'
                LIMIT 1
                """,
                (area_id,),
            ).fetchone()
            if occupied is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Khu vực đang có bàn phục vụ nên chưa thể ngừng sử dụng.",
                )

        try:
            connection.execute(
                """
                UPDATE restaurant_areas
                SET name = ?, display_order = ?, is_active = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (name, payload.display_order, int(payload.is_active), area_id),
            )
            connection.commit()
        except Exception as exc:
            if "UNIQUE" in str(exc).upper():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Tên khu vực đã tồn tại.",
                ) from exc
            raise
        row = connection.execute(
            "SELECT id, name, display_order, is_active FROM restaurant_areas WHERE id = ?",
            (area_id,),
        ).fetchone()
        assert row is not None
        result = area_row_to_output(row)
    backup_database(reason="pos-area-updated")
    return result


@router.get("/tables", response_model=list[RestaurantTableOutput])
def list_tables(
    area_id: int | None = Query(default=None),
    active_only: bool = Query(default=False),
) -> list[RestaurantTableOutput]:
    conditions: list[str] = []
    params: list[object] = []
    if area_id is not None:
        conditions.append("rt.area_id = ?")
        params.append(area_id)
    if active_only:
        conditions.append("rt.is_active = 1")
        conditions.append("ra.is_active = 1")
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with connect() as connection:
        rows = connection.execute(
            f"""
            SELECT
                rt.id, rt.area_id, ra.name AS area_name, rt.name, rt.seats,
                rt.display_order, rt.pos_x, rt.pos_y, rt.is_active,
                so.id AS open_order_id, so.order_code AS open_order_code,
                so.total_amount AS open_order_total,
                so.order_time AS open_order_time,
                so.guest_count AS guest_count
            FROM restaurant_tables AS rt
            JOIN restaurant_areas AS ra ON ra.id = rt.area_id
            LEFT JOIN sales_orders AS so
              ON so.table_id = rt.id AND so.status = 'OPEN'
            {where}
            ORDER BY ra.display_order ASC, rt.display_order ASC, rt.id ASC
            """,
            tuple(params),
        ).fetchall()
        return [table_row_to_output(row) for row in rows]


@router.post("/tables", response_model=RestaurantTableOutput, status_code=status.HTTP_201_CREATED)
def create_table(payload: RestaurantTableInput) -> RestaurantTableOutput:
    name = clean_name(payload.name)
    with connect() as connection:
        area = connection.execute(
            "SELECT id FROM restaurant_areas WHERE id = ?", (payload.area_id,)
        ).fetchone()
        if area is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy khu vực.")
        try:
            cursor = connection.execute(
                """
                INSERT INTO restaurant_tables (
                    area_id, name, seats, display_order,
                    pos_x, pos_y, is_active, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                (
                    payload.area_id, name, payload.seats, payload.display_order,
                    payload.pos_x, payload.pos_y, int(payload.is_active),
                ),
            )
            connection.commit()
        except Exception as exc:
            if "UNIQUE" in str(exc).upper():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Tên bàn đã tồn tại trong khu vực này.",
                ) from exc
            raise
        row = select_table(connection, int(cursor.lastrowid))
        assert row is not None
        result = table_row_to_output(row)
    backup_database(reason="pos-table-created")
    return result


@router.post(
    "/tables/bulk",
    response_model=list[RestaurantTableOutput],
    status_code=status.HTTP_201_CREATED,
)
def create_tables_bulk(payload: BulkTableCreateInput) -> list[RestaurantTableOutput]:
    with connect() as connection:
        area = connection.execute(
            "SELECT id, is_active FROM restaurant_areas WHERE id = ?",
            (payload.area_id,),
        ).fetchone()
        if area is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy khu vực.")
        if not bool(area["is_active"]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Khu vực đang ngừng sử dụng.",
            )

        existing_rows = connection.execute(
            """
            SELECT name, display_order
            FROM restaurant_tables
            WHERE area_id = ?
            ORDER BY display_order ASC, id ASC
            """,
            (payload.area_id,),
        ).fetchall()
        used_names = {str(row["name"]).strip().casefold() for row in existing_rows}
        next_order = (
            max((int(row["display_order"]) for row in existing_rows), default=-1) + 1
        )

        created_ids: list[int] = []
        name_number = 1
        for offset in range(payload.quantity):
            while f"Bàn {name_number}".casefold() in used_names:
                name_number += 1

            name = f"Bàn {name_number}"
            used_names.add(name.casefold())
            index = next_order + offset
            column = index % 5
            row = index // 5
            pos_x = min(82.0, 4.0 + column * 19.0)
            pos_y = min(84.0, 6.0 + row * 19.0)

            cursor = connection.execute(
                """
                INSERT INTO restaurant_tables (
                    area_id, name, seats, display_order,
                    pos_x, pos_y, is_active, created_at, updated_at
                )
                VALUES (?, ?, 0, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                (
                    payload.area_id,
                    name,
                    index,
                    pos_x,
                    pos_y,
                ),
            )
            created_ids.append(int(cursor.lastrowid))
            name_number += 1

        connection.commit()
        results: list[RestaurantTableOutput] = []
        for table_id in created_ids:
            row = select_table(connection, table_id)
            assert row is not None
            results.append(table_row_to_output(row))

    backup_database(reason="pos-tables-bulk-created")
    return results


@router.put("/tables/{table_id}", response_model=RestaurantTableOutput)
def update_table(table_id: int, payload: RestaurantTableInput) -> RestaurantTableOutput:
    name = clean_name(payload.name)
    with connect() as connection:
        existing = select_table(connection, table_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy bàn.")
        area = connection.execute(
            "SELECT id FROM restaurant_areas WHERE id = ?", (payload.area_id,)
        ).fetchone()
        if area is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy khu vực.")

        if existing["open_order_id"] is not None and (
            not payload.is_active or int(existing["area_id"]) != payload.area_id
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Bàn đang phục vụ; chưa thể đổi khu vực hoặc ngừng sử dụng.",
            )

        try:
            connection.execute(
                """
                UPDATE restaurant_tables
                SET area_id = ?, name = ?, seats = ?, display_order = ?,
                    pos_x = ?, pos_y = ?, is_active = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    payload.area_id, name, payload.seats, payload.display_order,
                    payload.pos_x, payload.pos_y, int(payload.is_active), table_id,
                ),
            )
            connection.commit()
        except Exception as exc:
            if "UNIQUE" in str(exc).upper():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Tên bàn đã tồn tại trong khu vực này.",
                ) from exc
            raise
        row = select_table(connection, table_id)
        assert row is not None
        result = table_row_to_output(row)
    backup_database(reason="pos-table-updated")
    return result


def get_installed_printers() -> list[str]:
    if os.name != "nt":
        return []
    try:
        result = subprocess.run(
            [
                "powershell", "-NoProfile", "-NonInteractive", "-Command",
                "Get-Printer | Sort-Object Name | Select-Object -ExpandProperty Name",
            ],
            check=False, capture_output=True, text=True, timeout=10,
            creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
        )
        if result.returncode != 0:
            return []
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]
    except (OSError, subprocess.TimeoutExpired):
        return []


@router.get("/printers", response_model=list[str])
def list_printers() -> list[str]:
    return get_installed_printers()


def pos_settings_output(settings: dict) -> PosSettingsOutput:
    # Choose cashier only if no valid setting has ever been saved.
    saved_target = settings.get("print_receipt_targets")
    target: PrinterTarget = (
        saved_target
        if saved_target in ("KITCHEN", "CASHIER", "BOTH")
        else "CASHIER"
    )
    return PosSettingsOutput(
        kitchen_printer_name=str(settings.get("kitchen_printer_name") or ""),
        cashier_printer_name=str(settings.get("cashier_printer_name") or ""),
        send_kitchen_targets="BOTH",
        print_receipt_targets=target,
    )


@router.get("/settings", response_model=PosSettingsOutput)
def get_pos_settings() -> PosSettingsOutput:
    return pos_settings_output(load_settings())


@router.put("/settings", response_model=PosSettingsOutput)
def update_pos_settings(payload: PosSettingsInput) -> PosSettingsOutput:
    settings = load_settings()
    settings["kitchen_printer_name"] = (payload.kitchen_printer_name or "").strip()
    settings["cashier_printer_name"] = (payload.cashier_printer_name or "").strip()
    settings["send_kitchen_targets"] = "BOTH"
    if payload.print_receipt_targets is not None:
        settings["print_receipt_targets"] = payload.print_receipt_targets
    save_settings(settings)
    return pos_settings_output(settings)



@router.get("/print-templates", response_model=dict[str, PrintTemplate])
def list_print_templates() -> dict[str, PrintTemplate]:
    return get_templates(load_settings())


@router.put("/print-templates/{kind}", response_model=PrintTemplate)
def save_print_template(kind: TemplateKind, payload: PrintTemplate) -> PrintTemplate:
    settings = load_settings()
    put_template(settings, kind, payload)
    save_settings(settings)
    return payload


@router.delete("/print-templates/{kind}", response_model=PrintTemplate)
def reset_print_template(kind: TemplateKind) -> PrintTemplate:
    settings = load_settings()
    template = default_template(kind)
    put_template(settings, kind, template)
    save_settings(settings)
    return template


@router.post("/print-templates/preview")
def preview_print_template(payload: TemplatePreviewInput) -> dict:
    return {
        "text": sample_print(payload.kind, payload.template),
        "template": payload.template.model_dump(),
    }


@router.post("/print-templates/{kind}/test")
def test_print_template(kind: TemplateKind, payload: PrintTemplate) -> dict:
    """Use a sample only, without creating sales or kitchen tickets."""
    settings = pos_settings_output(load_settings())
    printer_name = (
        settings.kitchen_printer_name if kind == "KITCHEN"
        else settings.cashier_printer_name
    )
    if not printer_name:
        return {"ok": False, "printer_name": None, "error": "Chưa cấu hình máy in."}
    ok, error = print_text(
        printer_name, with_print_style("BẢN IN THỬ - KHÔNG CÓ GIÁ TRỊ\r\n"
                                       + sample_print(kind, payload), payload)
    )
    return {"ok": ok, "printer_name": printer_name, "error": error}


def powershell_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def print_text(printer_name: str, content: str) -> tuple[bool, str | None]:
    """Print a Unicode receipt on a real 80 mm Windows paper size.

    Windows PrintDocument/GDI avoids Out-Printer's default A4 pagination
    and allows Vietnamese text via the installed Consolas font.
    """
    if not printer_name.strip():
        return False, "Chưa cấu hình máy in."
    if os.name != "nt":
        return False, "In trực tiếp chỉ hỗ trợ khi chạy trên Windows."

    # The in-band style header lets legacy print_text(name, content) mocks keep
    # their two-argument API, while each real Windows print uses its own sizes.
    title_pt, body_pt, total_pt, spacing, margin_mm = (11, 9, 14, 1.0, 2.0)
    if content.startswith("__OC11_FONT:"):
        header, separator, rest = content.partition("\r\n")
        try:
            values = header.removeprefix("__OC11_FONT:").removesuffix("__")
            parts = values.split(",")
            new_title, new_body, new_total = (int(part) for part in parts[:3])
            new_spacing = float(parts[3]) if len(parts) >= 4 else 1.0
            new_margin = float(parts[4]) if len(parts) >= 5 else 2.0
            if (12 <= new_title <= 24 and 10 <= new_body <= 18
                    and 14 <= new_total <= 26 and 1 <= new_spacing <= 1.8
                    and 1 <= new_margin <= 8):
                title_pt, body_pt, total_pt = new_title, new_body, new_total
                spacing, margin_mm = new_spacing, new_margin
                if separator:
                    content = rest
        except (ValueError, TypeError):
            pass

    text_path: Path | None = None
    script_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8-sig", suffix=".txt", delete=False
        ) as handle:
            handle.write(content)
            text_path = Path(handle.name)

        # PaperSize uses hundredths of an inch: 315 = ~80 mm.
        # The PrintPage canvas uses millimetres, independent of printer DPI.
        script = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies 'System.Drawing' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Printing;

public static class Oc11Thermal80 {
    public static void Print(string printer, string content, float titlePt, float bodyPt, float totalPt, float spacing, float margin) {
        string[] lines = content.Replace("\r\n", "\n").Split('\n');
        using (PrintDocument doc = new PrintDocument()) {
            doc.PrinterSettings.PrinterName = printer;
            if (!doc.PrinterSettings.IsValid)
                throw new Exception("Máy in không tồn tại trên Windows: " + printer);
            int height = Math.Min(12000, Math.Max(250, (lines.Length + 8) * Math.Max(28, (int)(bodyPt * 3.2f))));
            doc.DefaultPageSettings.PaperSize = new PaperSize("80mm", 315, height);
            doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
            doc.OriginAtMargins = false;
            doc.PrintController = new StandardPrintController();
            using (Font body = new Font("Consolas", bodyPt, FontStyle.Regular))
            using (Font heading = new Font("Consolas", titlePt, FontStyle.Bold))
            using (Font total = new Font("Consolas", totalPt, FontStyle.Bold)) {
                doc.PrintPage += (sender, e) => {
                    e.Graphics.PageUnit = GraphicsUnit.Millimeter;
                    float y = 2.0f;
                    for (int i = 0; i < lines.Length; i++) {
                        string line = lines[i];
                        string trimmed = line.Trim();
                        bool isHeading = trimmed == "CHẾ BIẾN" ||
                                         trimmed == "KIỂM ĐỒ" ||
                                         trimmed == "PHIẾU TẠM TÍNH" ||
                                         trimmed == "PHIẾU THANH TOÁN" ||
                                         (i + 1 < lines.Length && lines[i + 1].StartsWith("===="));
                        bool isTotal = trimmed.StartsWith("TỔNG TIỀN:");
                        Font chosen = isHeading ? heading : (isTotal ? total : body);
                        SizeF measured = e.Graphics.MeasureString(
                            line.Length == 0 ? " " : line, chosen, new SizeF(80.0f - margin - 2.0f, 1000.0f)
                        );
                        float lineHeight = Math.Max(4.0f, measured.Height + 0.5f);
                        e.Graphics.DrawString(
                            line, chosen, Brushes.Black,
                            new RectangleF(margin, y, 80.0f - margin - 2.0f, lineHeight + 2.0f)
                        );
                        y += lineHeight * spacing;
                    }
                    e.HasMorePages = false;
                };
                doc.Print();
            }
        }
    }
}
'@
$text = [System.IO.File]::ReadAllText($args[1], [System.Text.Encoding]::UTF8)
[Oc11Thermal80]::Print($args[0], $text, [float]$args[2], [float]$args[3], [float]$args[4], [float]::Parse($args[5], [System.Globalization.CultureInfo]::InvariantCulture), [float]$args[6])
"""
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8-sig", suffix=".ps1", delete=False
        ) as handle:
            handle.write(script)
            script_path = Path(handle.name)

        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive",
             "-ExecutionPolicy", "Bypass", "-File", str(script_path),
             printer_name, str(text_path), str(title_pt), str(body_pt), str(total_pt),
             str(spacing), str(margin_mm)],
            check=False, capture_output=True, text=True, timeout=25,
            creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
        )
        if result.returncode == 0:
            return True, None
        return False, (result.stderr or result.stdout or "Không in được phiếu.")[-600:].strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)
    finally:
        for path in (text_path, script_path):
            if path is not None:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass


def format_quantity(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:g}"


def current_kitchen_items(connection, order_id: int) -> list[dict]:
    """Create snapshot independent of volatile sales_order_items ids."""
    items = []
    for line in select_order_items(connection, order_id):
        extras = select_item_surcharges(connection, int(line["id"]))
        items.append({
            "sales_order_item_id": int(line["id"]),
            "name": line["item_name_snapshot"],
            "option": line["option_name_snapshot"],
            "unit": line["unit_name_snapshot"],
            "quantity": float(line["quantity"]),
            "note": line["note"],
            "surcharges": [extra["name"] for extra in extras],
        })
    return items


def printed_kitchen_snapshots(connection, order_id: int) -> list[dict]:
    rows = connection.execute(
        """
        SELECT payload_json FROM kitchen_tickets
        WHERE sales_order_id = ?
          AND (kitchen_print_ok = 1
               OR (kitchen_print_ok IS NULL AND print_status = 'PRINTED'))
        ORDER BY id
        """, (order_id,),
    ).fetchall()
    return [json.loads(row["payload_json"]) for row in rows]


def kitchen_payload(order, items: list[dict]) -> dict:
    return {
        "order_id": int(order["id"]),
        "order_code": order["order_code"],
        "order_type": order["order_type"],
        "table_id": int(order["table_id"]) if order["table_id"] is not None else None,
        "table_name": order["table_name"],
        "area_name": order["area_name"],
        "guest_count": int(order["guest_count"] or 0),
        "items": items,
    }


# Local POS normally runs one API process. Guard the reserve/print/update
# sequence against two simultaneous button presses in that process.
kitchen_send_lock = Lock()


def dispatch_print(settings: PosSettingsOutput, target: PrinterTarget, content: str):
    roles = ["KITCHEN", "CASHIER"] if target == "BOTH" else [target]
    results: list[PrintDestinationResult] = []
    attempted: dict[str, PrintDestinationResult] = {}
    for role in roles:
        name = (
            settings.kitchen_printer_name
            if role == "KITCHEN" else settings.cashier_printer_name
        ).strip()
        if name and name.casefold() in attempted:
            previous = attempted[name.casefold()]
            results.append(PrintDestinationResult(
                role=role, printer_name=name, ok=previous.ok, error=previous.error
            ))
            continue
        if not name:
            outcome = PrintDestinationResult(
                role=role, printer_name=None, ok=False,
                error=f"Chưa cấu hình máy in {'bếp' if role == 'KITCHEN' else 'thu ngân'}.",
            )
        else:
            ok, error = print_text(name, content)
            outcome = PrintDestinationResult(
                role=role, printer_name=name, ok=ok, error=error
            )
            attempted[name.casefold()] = outcome
        results.append(outcome)
    failures = [
        f"{'Bếp' if result.role == 'KITCHEN' else 'Thu ngân'}: {result.error or 'In lỗi'}"
        for result in results if not result.ok
    ]
    return (
        "FAILED" if failures else "PRINTED",
        "; ".join(failures) if failures else None,
        results,
    )


def build_cashier_receipt(connection, order, *, provisional: bool = False) -> str:
    kind: TemplateKind = "ESTIMATE" if provisional else "RECEIPT"
    template = get_templates(load_settings())[kind]
    rows = []
    for line in select_order_items(connection, int(order["id"])):
        rows.append({
            "name": line["item_name_snapshot"],
            "option": line["option_name_snapshot"],
            "quantity": float(line["quantity"]),
            "unit_price": int(line["unit_price"]),
            "line_total": int(line["line_total"]),
            "note": line["note"],
            "surcharges": [
                dict(extra) for extra in select_item_surcharges(connection, int(line["id"]))
            ],
        })
    surcharges = [
        dict(extra) for extra in select_order_surcharges(connection, int(order["id"]))
    ]
    return render_money_template(dict(order), rows, surcharges, kind, template)


@router.post("/printer/test")
def test_kitchen_printer(
    role: Literal["KITCHEN", "CASHIER"] = Query(default="KITCHEN"),
) -> dict[str, str | bool | None]:
    settings = pos_settings_output(load_settings())
    printer_name = (
        settings.kitchen_printer_name
        if role == "KITCHEN" else settings.cashier_printer_name
    )
    label = "BẾP" if role == "KITCHEN" else "THU NGÂN"
    content = (
        f"ỐC 11 - TEST MÁY IN {label}\r\n"
        "============================\r\n"
        f"{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\r\n"
        "Nếu đọc được phiếu này, máy in đã sẵn sàng.\r\n\r\n"
    )
    if not printer_name:
        return {"ok": False, "printer_name": None, "error": f"Chưa cấu hình máy in {label}."}
    ok, error = print_text(printer_name, content)
    return {"ok": ok, "printer_name": printer_name or None, "error": error}


@router.post("/orders/{order_id}/send-kitchen", response_model=KitchenSendOutput)
def send_order_to_kitchen(
    order_id: int, payload: KitchenSendInput | None = None,
) -> KitchenSendOutput:
    settings = pos_settings_output(load_settings())
    temporary_note = payload.temporary_note if payload else ""

    with kitchen_send_lock:
        with connect() as connection:
            order = select_order(connection, order_id)
            if order is None:
                raise HTTPException(status_code=404, detail="Không tìm thấy đơn bán.")
            if order["status"] != "OPEN":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Chỉ gửi bếp với Order đang phục vụ.",
                )

            # Retry only a partially printed batch. If neither printer succeeded,
            # make a fresh snapshot from the current order instead, so an edit
            # cannot accidentally send a stale failed ticket to the kitchen.
            retry = connection.execute(
                """
                SELECT * FROM kitchen_tickets
                WHERE sales_order_id = ? AND print_status = 'FAILED'
                  AND kitchen_print_ok IS NOT NULL
                  AND check_print_ok IS NOT NULL
                  AND (kitchen_print_ok = 1 OR check_print_ok = 1)
                ORDER BY id LIMIT 1
                """, (order_id,),
            ).fetchone()
            if retry is not None:
                ticket_id = int(retry["id"])
                sent_at = retry["sent_at"]
                ticket_items = json.loads(retry["payload_json"])["items"]
                kitchen_ok = bool(retry["kitchen_print_ok"])
                check_ok = bool(retry["check_print_ok"])
            else:
                current = current_kitchen_items(connection, order_id)
                prior = printed_kitchen_snapshots(connection, order_id)
                ticket_items = unsent_items(current, prior)
                if not ticket_items:
                    return KitchenSendOutput(
                        ticket_id=None, order_id=order_id,
                        order_code=order["order_code"], sent_at=None,
                        printer_name=None, print_status="NO_NEW_ITEMS",
                        error_message=None, printer_results=[],
                    )
                sent_at = datetime.now().isoformat(timespec="microseconds")
                snapshot = kitchen_payload(order, ticket_items)
                cursor = connection.execute(
                    """
                    INSERT INTO kitchen_tickets (
                        sales_order_id, sent_at, printer_name,
                        print_status, error_message, payload_json,
                        kitchen_print_ok, check_print_ok
                    ) VALUES (?, ?, NULL, 'FAILED', NULL, ?, 0, 0)
                    """,
                    (order_id, sent_at, json.dumps(snapshot, ensure_ascii=False)),
                )
                ticket_id = int(cursor.lastrowid)
                connection.commit()
                kitchen_ok = False
                check_ok = False

            # Both slips are mandatory for Gửi bếp, regardless of the legacy
            # send_kitchen_targets setting. They are different documents even
            # when both configured printer names refer to one physical printer.
            batch_number = int(connection.execute(
                "SELECT COUNT(*) FROM kitchen_tickets "
                "WHERE sales_order_id = ? AND id <= ?",
                (order_id, ticket_id),
            ).fetchone()[0])
            results: list[PrintDestinationResult] = []
            templates = get_templates(load_settings())
            for role, already_ok in (
                ("KITCHEN", kitchen_ok), ("CASHIER", check_ok)
            ):
                printer_name = (
                    settings.kitchen_printer_name if role == "KITCHEN"
                    else settings.cashier_printer_name
                ).strip()
                if already_ok:
                    result = PrintDestinationResult(
                        role=role, printer_name=printer_name or None, ok=True,
                    )
                elif not printer_name:
                    result = PrintDestinationResult(
                        role=role, printer_name=None, ok=False,
                        error="Chưa cấu hình máy in "
                              + ("bếp." if role == "KITCHEN" else "thu ngân."),
                    )
                else:
                    kind: TemplateKind = "KITCHEN" if role == "KITCHEN" else "CHECK"
                    template = templates[kind]
                    text = render_kitchen_template(
                        dict(order), ticket_items, kind, template,
                        sent_at=sent_at, batch_number=batch_number,
                        temporary_note=temporary_note,
                    )
                    ok, error = print_text(printer_name, with_print_style(text, template))
                    result = PrintDestinationResult(
                        role=role, printer_name=printer_name, ok=ok, error=error,
                    )
                results.append(result)
                # Persist each destination immediately, so retry never
                # knowingly reprints a successfully dispatched slip.
                if result.ok and not already_ok:
                    col = "kitchen_print_ok" if role == "KITCHEN" else "check_print_ok"
                    connection.execute(
                        f"UPDATE kitchen_tickets SET {col} = 1 WHERE id = ?",
                        (ticket_id,),
                    )
                    if role == "KITCHEN":
                        connection.execute(
                            """
                            UPDATE sales_orders
                            SET kitchen_sent_at = ?, updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                            """, (sent_at, order_id),
                        )
                    connection.commit()

            failures = [
                ("Bếp" if r.role == "KITCHEN" else "Thu ngân")
                + ": " + (r.error or "In lỗi")
                for r in results if not r.ok
            ]
            print_status = "FAILED" if failures else "PRINTED"
            error_message = "; ".join(failures) if failures else None
            printer_names = list(dict.fromkeys(
                r.printer_name for r in results if r.printer_name
            ))
            connection.execute(
                """
                UPDATE kitchen_tickets
                SET print_status = ?, error_message = ?, printer_name = ?
                WHERE id = ?
                """,
                (print_status, error_message,
                 ", ".join(printer_names) or None, ticket_id),
            )
            connection.commit()
            output = KitchenSendOutput(
                ticket_id=ticket_id, order_id=order_id,
                order_code=order["order_code"], sent_at=sent_at,
                printer_name=", ".join(printer_names) or None,
                print_status=print_status, error_message=error_message,
                printer_results=results,
            )
    backup_database(reason="kitchen-ticket")
    return output


@router.post("/orders/{order_id}/print-receipt", response_model=PrintDispatchOutput)
def print_sale_receipt(order_id: int) -> PrintDispatchOutput:
    settings = pos_settings_output(load_settings())
    with connect() as connection:
        order = select_order(connection, order_id)
        if order is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy đơn bán.")
        if order["status"] != "PAID":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Chỉ in phiếu thanh toán cho đơn đã thanh toán.",
            )
        content = build_cashier_receipt(connection, order)
        template = get_templates(load_settings())["RECEIPT"]
        print_status, error, results = dispatch_print(
            settings, settings.print_receipt_targets, with_print_style(content, template)
        )
        return PrintDispatchOutput(
            order_id=order_id,
            order_code=order["order_code"],
            print_status=print_status,
            error_message=error,
            printer_results=results,
        )


@router.post("/orders/{order_id}/print-estimate", response_model=PrintDispatchOutput)
def print_sale_estimate(order_id: int) -> PrintDispatchOutput:
    """Print a provisional 80 mm bill to cashier without closing the order."""
    settings = pos_settings_output(load_settings())
    with connect() as connection:
        order = select_order(connection, order_id)
        if order is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy đơn bán.")
        if order["status"] != "OPEN":
            raise HTTPException(status_code=409, detail="Chỉ in tạm tính cho Order đang phục vụ.")
        content = build_cashier_receipt(connection, order, provisional=True)
        template = get_templates(load_settings())["ESTIMATE"]
        print_status, error, results = dispatch_print(
            settings, "CASHIER", with_print_style(content, template)
        )
        return PrintDispatchOutput(
            order_id=order_id, order_code=order["order_code"],
            print_status=print_status, error_message=error, printer_results=results,
        )


@router.post("/orders/{order_id}/print-cancel", response_model=PrintDispatchOutput)
def print_sale_cancel(order_id: int) -> PrintDispatchOutput:
    """Print an explicit cancellation; never resend old kitchen item tickets."""
    settings = pos_settings_output(load_settings())
    with connect() as connection:
        order = select_order(connection, order_id)
        if order is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy đơn bán.")
        if order["status"] != "VOID":
            raise HTTPException(status_code=409, detail="Chỉ in phiếu hủy cho Order đã hủy.")
        if order["kitchen_sent_at"] is None:
            raise HTTPException(status_code=409, detail="Order chưa gửi bếp.")
        lines = [
            "ỐC 11 - HỦY TOÀN BỘ ORDER", "=" * 36,
            f"Mã đơn: {order['order_code']}",
            f"Bàn: {order['area_name'] or ''} / {order['table_name'] or ''}",
            "-" * 36,
        ]
        for item in select_order_items(connection, order_id):
            lines.append(
                f"{format_quantity(float(item['quantity']))} x {item['item_name_snapshot']}"
            )
            if item["option_name_snapshot"]:
                lines.append(f"  {item['option_name_snapshot']}")
        lines.extend([
            "-" * 36,
            f"Lý do: {order['void_reason'] or 'Hủy order'}",
            "KHÔNG CHẾ BIẾN / NGỪNG CHẾ BIẾN",
            "", "", "",
        ])
        print_status, error, results = dispatch_print(
            settings, "KITCHEN", "\r\n".join(lines)
        )
        return PrintDispatchOutput(
            order_id=order_id, order_code=order["order_code"],
            print_status=print_status, error_message=error, printer_results=results,
        )
