import json
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect
from .sales import select_item_surcharges, select_order, select_order_items, select_order_surcharges
from .settings import load_settings, save_settings


router = APIRouter(prefix="/api/pos", tags=["pos"])


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
    send_kitchen_targets: PrinterTarget = "KITCHEN"
    print_receipt_targets: PrinterTarget = "CASHIER"


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
    ticket_id: int
    sent_at: str
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
    def target(key: str, default: PrinterTarget) -> PrinterTarget:
        value = settings.get(key)
        return value if value in ("KITCHEN", "CASHIER", "BOTH") else default

    return PosSettingsOutput(
        kitchen_printer_name=str(settings.get("kitchen_printer_name") or ""),
        cashier_printer_name=str(settings.get("cashier_printer_name") or ""),
        send_kitchen_targets=target("send_kitchen_targets", "KITCHEN"),
        print_receipt_targets=target("print_receipt_targets", "CASHIER"),
    )


@router.get("/settings", response_model=PosSettingsOutput)
def get_pos_settings() -> PosSettingsOutput:
    return pos_settings_output(load_settings())


@router.put("/settings", response_model=PosSettingsOutput)
def update_pos_settings(payload: PosSettingsInput) -> PosSettingsOutput:
    settings = load_settings()
    settings["kitchen_printer_name"] = (payload.kitchen_printer_name or "").strip()
    settings["cashier_printer_name"] = (payload.cashier_printer_name or "").strip()
    settings["send_kitchen_targets"] = payload.send_kitchen_targets
    settings["print_receipt_targets"] = payload.print_receipt_targets
    save_settings(settings)
    return pos_settings_output(settings)


def powershell_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def print_text(printer_name: str, content: str) -> tuple[bool, str | None]:
    if not printer_name.strip():
        return False, "Chưa cấu hình máy in bếp."
    if os.name != "nt":
        return False, "In bếp trực tiếp chỉ hỗ trợ khi chạy trên Windows."

    path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8-sig", suffix=".txt", delete=False
        ) as handle:
            handle.write(content)
            path = Path(handle.name)

        command = (
            f"Get-Content -LiteralPath {powershell_quote(str(path))} "
            f"-Raw -Encoding UTF8 | Out-Printer -Name {powershell_quote(printer_name)}"
        )
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
            check=False, capture_output=True, text=True, timeout=20,
            creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
        )
        if result.returncode == 0:
            return True, None
        error = (result.stderr or result.stdout or "Không in được phiếu bếp.").strip()
        return False, error[-600:]
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)
    finally:
        if path is not None:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


def format_quantity(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:g}"


def build_kitchen_ticket(connection, order, temporary_note: str = "") -> tuple[str, dict]:
    lines = select_order_items(connection, int(order["id"]))
    payload_items = []
    text_lines = [
        "ỐC 11 - PHIẾU BẾP",
        "=" * 36,
        f"Mã đơn: {order['order_code']}",
    ]
    if order["order_type"] == "DINE_IN":
        area = order["area_name"] or ""
        table = order["table_name"] or ""
        text_lines.append(f"Bàn: {area} / {table}".strip(" /"))
        if int(order["guest_count"] or 0) > 0:
            text_lines.append(f"Số khách: {int(order['guest_count'])}")
    else:
        text_lines.append("Loại: MANG VỀ")
    text_lines.extend(
        [f"Giờ gửi: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}", "-" * 36]
    )

    for line in lines:
        quantity = float(line["quantity"])
        text_lines.append(f"{format_quantity(quantity)} x {line['item_name_snapshot']}")
        if line["option_name_snapshot"]:
            text_lines.append(f"  + {line['option_name_snapshot']}")
        surcharges = select_item_surcharges(connection, int(line["id"]))
        for surcharge in surcharges:
            text_lines.append(f"  + {surcharge['name']}")
        if line["note"]:
            text_lines.append(f"  * {line['note']}")
        payload_items.append(
            {
                "sales_order_item_id": int(line["id"]),
                "name": line["item_name_snapshot"],
                "option": line["option_name_snapshot"],
                "quantity": quantity,
                "note": line["note"],
                "surcharges": [row["name"] for row in surcharges],
            }
        )

    if order["note"]:
        text_lines.extend(["-" * 36, f"Ghi chú đơn: {order['note']}"])
    if temporary_note.strip():
        text_lines.extend(["-" * 36, "GHI CHÚ GỬI BẾP:", temporary_note.strip()])
    text_lines.extend(["=" * 36, "", "", ""])
    payload = {
        "order_id": int(order["id"]),
        "order_code": order["order_code"],
        "order_type": order["order_type"],
        "table_id": int(order["table_id"]) if order["table_id"] is not None else None,
        "table_name": order["table_name"],
        "area_name": order["area_name"],
        "guest_count": int(order["guest_count"] or 0),
        "items": payload_items,
    }
    return "\r\n".join(text_lines), payload


@router.post("/printer/test")
def test_kitchen_printer() -> dict[str, str | bool | None]:
    printer_name = str(load_settings().get("kitchen_printer_name") or "").strip()
    content = (
        "ỐC 11 - TEST MÁY IN BẾP\r\n"
        "============================\r\n"
        f"{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\r\n"
        "Nếu đọc được phiếu này, máy in đã sẵn sàng.\r\n\r\n"
    )
    ok, error = print_text(printer_name, content)
    return {"ok": ok, "printer_name": printer_name or None, "error": error}


@router.post("/orders/{order_id}/send-kitchen", response_model=KitchenSendOutput)
def send_order_to_kitchen(order_id: int) -> KitchenSendOutput:
    sent_at = datetime.now().isoformat(timespec="microseconds")
    printer_name = str(load_settings().get("kitchen_printer_name") or "").strip()

    with connect() as connection:
        order = select_order(connection, order_id)
        if order is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy đơn bán.")
        if order["status"] == "VOID":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Đơn đã hủy nên không thể gửi bếp.",
            )

        content, payload = build_kitchen_ticket(connection, order)
        ok, error = print_text(printer_name, content)
        print_status = "PRINTED" if ok else "FAILED"
        cursor = connection.execute(
            """
            INSERT INTO kitchen_tickets (
                sales_order_id, sent_at, printer_name,
                print_status, error_message, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                order_id, sent_at, printer_name or None, print_status, error,
                json.dumps(payload, ensure_ascii=False),
            ),
        )
        if ok:
            connection.execute(
                """
                UPDATE sales_orders
                SET kitchen_sent_at = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (sent_at, order_id),
            )
        connection.commit()

        result = KitchenSendOutput(
            ticket_id=int(cursor.lastrowid),
            order_id=order_id,
            order_code=order["order_code"],
            sent_at=sent_at,
            printer_name=printer_name or None,
            print_status=print_status,
            error_message=error,
        )

    backup_database(reason="kitchen-ticket")
    return result
