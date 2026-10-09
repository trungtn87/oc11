"""Editable 80 mm POS receipt templates. Presentation only: no sale or stock mutation."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

TemplateKind = Literal["KITCHEN", "CHECK", "ESTIMATE", "RECEIPT"]
KINDS: tuple[TemplateKind, ...] = ("KITCHEN", "CHECK", "ESTIMATE", "RECEIPT")


class PrintTemplate(BaseModel):
    title_font_pt: int = Field(default=18, ge=12, le=24)
    body_font_pt: int = Field(default=12, ge=10, le=18)
    total_font_pt: int = Field(default=20, ge=14, le=26)
    line_spacing: float = Field(default=1.0, ge=1.0, le=1.8)
    left_margin_mm: int = Field(default=2, ge=1, le=8)
    title_text: str = Field(default="", max_length=80)
    shop_name: str = Field(default="ỐC 11", max_length=80)
    shop_phone: str = Field(default="", max_length=60)
    shop_address: str = Field(default="", max_length=180)
    footer_text: str = Field(default="Cảm ơn quý khách!", max_length=180)
    show_shop_name: bool = True
    show_phone: bool = False
    show_address: bool = False
    show_table: bool = True
    show_time: bool = True
    show_options: bool = True
    show_notes: bool = True
    show_surcharges: bool = True
    show_prices: bool = True
    show_payment: bool = False
    show_footer: bool = True


class TemplatePreviewInput(BaseModel):
    kind: TemplateKind
    template: PrintTemplate


def default_template(kind: TemplateKind) -> PrintTemplate:
    base = {
        "KITCHEN": dict(show_shop_name=False, show_prices=False, show_payment=False,
                        show_footer=False, show_surcharges=True),
        "CHECK": dict(show_shop_name=False, show_prices=False, show_payment=False,
                      show_footer=False, show_surcharges=False),
        "ESTIMATE": dict(show_shop_name=True, show_prices=True, show_notes=False,
                         show_payment=False),
        "RECEIPT": dict(show_shop_name=True, show_prices=True, show_notes=False,
                        show_payment=True),
    }
    return PrintTemplate(**base[kind])


def get_templates(settings: dict) -> dict[str, PrintTemplate]:
    saved = settings.get("print_templates")
    saved = saved if isinstance(saved, dict) else {}
    result = {}
    for kind in KINDS:
        default = default_template(kind)
        payload = saved.get(kind)
        if isinstance(payload, dict):
            try:
                default = PrintTemplate.model_validate({**default.model_dump(), **payload})
            except ValueError:
                pass  # Faulty old config must not stop the POS from booting.
        result[kind] = default
    return result


def put_template(settings: dict, kind: TemplateKind, template: PrintTemplate) -> None:
    configs = settings.get("print_templates")
    configs = dict(configs) if isinstance(configs, dict) else {}
    configs[kind] = template.model_dump()
    settings["print_templates"] = configs


def plain_money(value: int | float) -> str:
    return f"{round(value):,}".replace(",", ".") + " đ"


def quantity(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def heading(kind: TemplateKind) -> str:
    return {
        "KITCHEN": "CHẾ BIẾN",
        "CHECK": "KIỂM ĐỒ",
        "ESTIMATE": "PHIẾU TẠM TÍNH",
        "RECEIPT": "PHIẾU THANH TOÁN",
    }[kind]


def _rows(text: str, width: int = 32) -> list[str]:
    """Keep Unicode strings intact; Windows GDI performs final physical wrapping."""
    import textwrap
    return textwrap.wrap(" ".join(str(text).split()), width=width,
                         break_long_words=False, break_on_hyphens=False) or [""]


def base_header(order: dict, kind: TemplateKind, tpl: PrintTemplate,
                *, sent_at: str | None = None, batch_number: int = 1) -> list[str]:
    result = []
    if tpl.show_shop_name and tpl.shop_name.strip():
        result.append(tpl.shop_name.strip())
    if tpl.show_phone and tpl.shop_phone.strip():
        result.append("ĐT: " + tpl.shop_phone.strip())
    if tpl.show_address and tpl.shop_address.strip():
        result.extend(_rows(tpl.shop_address.strip()))
    result += [tpl.title_text.strip() or heading(kind), "=" * 32, "Mã đơn: " + str(order["order_code"])]
    if tpl.show_table:
        if order.get("order_type") == "DINE_IN":
            result.extend(_rows("Bàn: " + str(order.get("table_name") or "")
                                + "  (" + str(order.get("area_name") or "") + ")"))
        else:
            result.append("MANG VỀ")
    if tpl.show_time:
        timestamp = sent_at if sent_at else (
            order.get("paid_at") if kind == "RECEIPT" else order.get("order_time")
        )
        if timestamp:
            try:
                timestamp = datetime.fromisoformat(str(timestamp)).strftime("%d/%m/%Y %H:%M")
            except ValueError:
                timestamp = str(timestamp)
            result.append("Ngày: " + timestamp)
    if kind in ("KITCHEN", "CHECK"):
        result.append(f"Lần gửi: {batch_number} - MÓN MỚI")
    result.append("-" * 32)
    return result


def render_kitchen_template(order: dict, items: list[dict], kind: TemplateKind,
                            tpl: PrintTemplate, *, sent_at: str,
                            batch_number: int, temporary_note: str = "") -> str:
    if kind not in ("KITCHEN", "CHECK"):
        raise ValueError("Not a kitchen or checking template")
    lines = base_header(order, kind, tpl, sent_at=sent_at, batch_number=batch_number)
    lines.append("Món                         SL")
    lines.append("-" * 32)
    for item in items:
        prefix = "[ ] " if kind == "CHECK" else ""
        lines += _rows(prefix + str(item["name"]) + "   x " + quantity(float(item["quantity"])))
        if tpl.show_options and item.get("option"):
            lines += _rows("  + " + str(item["option"]))
        if tpl.show_surcharges:
            for surcharge in item.get("surcharges") or []:
                lines += _rows("  + " + str(surcharge))
        if tpl.show_notes and item.get("note"):
            lines += _rows("  * " + str(item["note"]))
        lines.append("-" * 32)
    if kind == "CHECK":
        lines.append("Đã kiểm: ______ / ______")
    if tpl.show_notes and temporary_note.strip():
        lines.append("GHI CHÚ GỬI BẾP:")
        for part in temporary_note.splitlines():
            lines.extend(_rows(part))
    if tpl.show_footer and tpl.footer_text.strip():
        lines.extend(_rows(tpl.footer_text.strip()))
    lines.extend(["=" * 32, "", "", ""])
    return "\r\n".join(lines)


def render_money_template(order: dict, items: list[dict],
                          surcharges: list[dict], kind: TemplateKind,
                          tpl: PrintTemplate) -> str:
    if kind not in ("ESTIMATE", "RECEIPT"):
        raise ValueError("Not a cashier template")
    lines = base_header(order, kind, tpl)
    for item in items:
        lines.extend(_rows(str(item["name"])))
        if tpl.show_options and item.get("option"):
            lines.extend(_rows("  + " + str(item["option"])))
        if tpl.show_prices:
            unit_price = item.get("unit_price", 0)
            lines.extend(_rows("  " + quantity(float(item["quantity"]))
                               + " x " + plain_money(unit_price)))
        else:
            lines.append("  SL: " + quantity(float(item["quantity"])))
        lines.append("  Thành tiền: " + plain_money(item["line_total"]))
        if tpl.show_surcharges:
            for extra in item.get("surcharges") or []:
                lines.extend(_rows("  + " + str(extra["name"]) + ": "
                                   + plain_money(extra["amount"])))
        if tpl.show_notes and item.get("note"):
            lines.extend(_rows("  * " + str(item["note"])))
        lines.append("-" * 32)
    if tpl.show_surcharges:
        for extra in surcharges:
            lines.extend(_rows("Phụ thu " + str(extra["name"]) + ": "
                               + plain_money(extra["amount"])))
    lines.append("TỔNG TIỀN: " + plain_money(order["total_amount"]))
    if kind == "ESTIMATE":
        lines.append("CHƯA THANH TOÁN")
    else:
        if tpl.show_payment:
            account_type = order.get("fund_account_type")
            method = "Chuyển khoản" if account_type == "BANK" else "Tiền mặt"
            if order.get("settlement_status") == "DEBT":
                method = "Ghi nợ"
            lines.append("Thanh toán: " + method)
            if order.get("actual_received_amount") is not None:
                lines.append("THỰC THU: " + plain_money(order["actual_received_amount"]))
        lines.append("ĐÃ THANH TOÁN")
    if tpl.show_footer and tpl.footer_text.strip():
        lines += _rows(tpl.footer_text.strip())
    lines += ["=" * 32, "", "", ""]
    return "\r\n".join(lines)


def with_print_style(content: str, tpl: PrintTemplate) -> str:
    """Private header decoded by print_text; no persisted changes to ticket snapshots."""
    return (f"__OC11_FONT:{tpl.title_font_pt},{tpl.body_font_pt},"
            f"{tpl.total_font_pt},{tpl.line_spacing},{tpl.left_margin_mm}__\r\n" + content)


def sample_print(kind: TemplateKind, tpl: PrintTemplate) -> str:
    order = dict(order_code="BH000031", order_type="DINE_IN",
                 area_name="Tầng 1", table_name="Bàn 1",
                 order_time="2026-10-09T16:59:00", paid_at="2026-10-09T16:59:00",
                 total_amount=420000, actual_received_amount=420000,
                 fund_account_type="CASH", settlement_status="PAID")
    items = [
        dict(name="Ốc hương", quantity=1, option="Hấp", unit_price=150000,
             line_total=150000, note="Ít cay", surcharges=[]),
        dict(name="Mực trứng", quantity=1, option="Hấp", unit_price=240000,
             line_total=240000, note="", surcharges=[]),
        dict(name="Bánh mỳ phô mai", quantity=1, option="", unit_price=30000,
             line_total=30000, note="", surcharges=[]),
    ]
    if kind in ("KITCHEN", "CHECK"):
        return render_kitchen_template(order, items, kind, tpl,
                                       sent_at=order["order_time"], batch_number=1,
                                       temporary_note="Ra đồ cùng lúc")
    return render_money_template(order, items, [], kind, tpl)
