"""Last purchase prices for offline Android ordering.

Keep this separate from inventory stock snapshots: purchasing defaults may
still be useful for an item whose stock is zero or tracking is disabled.
"""
from datetime import datetime
from math import isfinite

from fastapi import APIRouter
from pydantic import BaseModel

from .database import connect
from .inventory import last_purchase

router = APIRouter(prefix="/api/items", tags=["items"])


class PurchaseUnitDefault(BaseModel):
    unit_id: int
    unit_name: str
    suggested_unit_price: int


class ItemPurchaseDefault(BaseModel):
    item_id: int
    default_unit_id: int
    last_purchase_time: str | None
    last_purchase_receipt_code: str | None
    last_purchase_unit_id: int | None
    last_purchase_unit_price: int | None
    unit_prices: list[PurchaseUnitDefault]


@router.get("/purchase-defaults", response_model=list[ItemPurchaseDefault])
def list_item_purchase_defaults() -> list[ItemPurchaseDefault]:
    """Read-only bulk snapshot. Prices in VND for each currently active unit."""
    now = datetime.now().isoformat(timespec="microseconds")
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT i.id, i.default_unit_id
            FROM items AS i
            ORDER BY i.id
            """
        ).fetchall()
        result: list[ItemPurchaseDefault] = []
        for item in rows:
            purchase = last_purchase(connection, item["id"], as_of=now)
            suggestions: list[PurchaseUnitDefault] = []
            if purchase is not None:
                last_factor = float(purchase["conversion_factor"])
                if last_factor > 0 and isfinite(last_factor):
                    per_smallest = float(purchase["unit_price"]) / last_factor
                    conversions = connection.execute(
                        """
                        SELECT c.unit_id, u.name AS unit_name,
                               c.quantity_in_smallest_unit AS factor
                        FROM item_unit_conversions AS c
                        JOIN units AS u ON u.id = c.unit_id
                        WHERE c.item_id = ? AND c.is_active = 1
                        ORDER BY c.id
                        """,
                        (item["id"],),
                    ).fetchall()
                    for unit in conversions:
                        if unit["unit_id"] == purchase["unit_id"]:
                            price = int(purchase["unit_price"])
                        else:
                            estimate = per_smallest * float(unit["factor"])
                            if not isfinite(estimate) or estimate < 0 or estimate > 9_223_372_036_854_775_807:
                                continue
                            # Prices are integer VND; rounding halfway up.
                            price = int(estimate + 0.5)
                        suggestions.append(
                            PurchaseUnitDefault(
                                unit_id=unit["unit_id"],
                                unit_name=unit["unit_name"],
                                suggested_unit_price=price,
                            )
                        )

            result.append(
                ItemPurchaseDefault(
                    item_id=item["id"],
                    default_unit_id=item["default_unit_id"],
                    last_purchase_time=(
                        purchase["receipt_time"] if purchase is not None else None
                    ),
                    last_purchase_receipt_code=(
                        purchase["receipt_code"] if purchase is not None else None
                    ),
                    last_purchase_unit_id=(
                        purchase["unit_id"] if purchase is not None else None
                    ),
                    last_purchase_unit_price=(
                        purchase["unit_price"] if purchase is not None else None
                    ),
                    unit_prices=suggestions,
                )
            )
        return result
