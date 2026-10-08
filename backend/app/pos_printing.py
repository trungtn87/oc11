"""Stable kitchen send quantities and 80 mm text layouts.

Kitchen tickets are snapshots, not references to sales_order_items ids: editing
a sale recreates those ids. Identity therefore uses the printed variant.
"""
import json
import textwrap
from collections import defaultdict
from datetime import datetime

RECEIPT_COLUMNS = 32


def item_identity(item: dict) -> str:
    """Use dish + preparation, never note, surcharge or volatile line id.

    Editing an already sent dish's note must not send it again. Quantities
    across differently annotated lines of the same dish are summed; new
    lines are allocated the remaining unsent quantity in cart order.
    Legacy tickets contain the same dish/preparation snapshots.
    """
    return json.dumps([
        str(item.get("name") or "").strip(),
        str(item.get("option") or "").strip(),
    ], ensure_ascii=False)


def unsent_items(current: list[dict], printed_snapshots: list[dict]) -> list[dict]:
    """Subtract historically acknowledged kitchen quantities, including legacy tickets."""
    sent = defaultdict(float)
    for snapshot in printed_snapshots:
        for item in snapshot.get("items", []):
            sent[item_identity(item)] += float(item["quantity"])

    pending = []
    for item in current:
        key = item_identity(item)
        quantity = float(item["quantity"])
        already = min(quantity, sent[key])
        sent[key] -= already
        remaining = round(quantity - already, 6)
        if remaining > 0:
            pending.append({**item, "quantity": remaining})
    return pending


def quantity_label(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def _wrap(value: str, width: int) -> list[str]:
    return textwrap.wrap(
        " ".join(str(value).split()), width=width,
        break_long_words=True, break_on_hyphens=False,
    ) or [""]


def _item_rows(item: dict, checking: bool) -> list[str]:
    prefix = "[ ] " if checking else ""
    name_width = 18 if checking else 22
    unit = str(item.get("unit") or "").strip()
    qty = quantity_label(float(item["quantity"]))
    parts = _wrap(prefix + str(item["name"]), name_width)
    rows = [f"{parts[0]:<{name_width}} {unit[:5]:<5} {qty:>3}"]
    rows.extend(parts[1:])
    if item.get("option"):
        rows.extend("  " + part for part in _wrap(
            "+ " + str(item["option"]), RECEIPT_COLUMNS - 2
        ))
    for surcharge in item.get("surcharges") or []:
        rows.extend("  " + part for part in _wrap(
            "+ " + str(surcharge), RECEIPT_COLUMNS - 2
        ))
    if item.get("note"):
        rows.extend("  " + part for part in _wrap(
            "* " + str(item["note"]), RECEIPT_COLUMNS - 2
        ))
    return rows


def render_80mm_ticket(order, items: list[dict], *, checking: bool,
                       sent_at: str, batch_number: int,
                       temporary_note: str = "") -> str:
    """32-column thermal layout, no prices; checklist is a separate document."""
    title = "KIỂM ĐỒ" if checking else "CHẾ BIẾN"
    stamp = datetime.fromisoformat(sent_at).strftime("%d/%m/%Y %H:%M")
    rows = [
        title.center(RECEIPT_COLUMNS),
        "=" * RECEIPT_COLUMNS,
        f"Order: {order['order_code']}",
        f"Ngày: {stamp}",
        f"Lần gửi: {batch_number} - MÓN MỚI",
    ]
    if order["order_type"] == "DINE_IN":
        rows.extend(_wrap(
            f"Bàn: {order['table_name'] or ''}  ({order['area_name'] or ''})",
            RECEIPT_COLUMNS
        ))
    else:
        rows.append("MANG VỀ")
    rows.extend([
        "-" * RECEIPT_COLUMNS,
        f"{'Món'.ljust(18 if checking else 22)} ĐVT    SL",
        "-" * RECEIPT_COLUMNS
    ])
    for item in items:
        rows.extend(_item_rows(item, checking))
        rows.append("-" * RECEIPT_COLUMNS)
    if checking:
        rows.append("Da kiem: ______ / ______")
    if temporary_note.strip():
        rows.append("GHI CHÚ GỬI BẾP:" if checking else "GHI CHÚ GỬI BẾP:")
        for paragraph in temporary_note.splitlines():
            rows.extend(_wrap(paragraph, RECEIPT_COLUMNS))
    rows.extend(["=" * RECEIPT_COLUMNS, "", "", ""])
    return "\r\n".join(rows)
