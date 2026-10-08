from fastapi.testclient import TestClient

from backend.app.main import app
from backend.tests.test_inventory import setup_inventory_master, create_purchase


def prices_by_unit(row):
    return {
        unit["unit_id"]: unit["suggested_unit_price"]
        for unit in row["unit_prices"]
    }


def test_latest_purchase_defaults_and_unit_conversion(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))
    with TestClient(app) as client:
        _, thung, lon, item, supplier = setup_inventory_master(client)

        empty = client.get("/api/items/purchase-defaults")
        assert empty.status_code == 200
        first = next(x for x in empty.json() if x["item_id"] == item["id"])
        assert first["default_unit_id"] == thung["id"]
        assert first["last_purchase_unit_price"] is None
        assert first["unit_prices"] == []

        create_purchase(
            client,
            supplier_id=supplier["id"],
            item_id=item["id"],
            unit_id=thung["id"],
            receipt_time="2026-10-01T08:00",
            quantity=2,
            unit_price=240_000,
        )
        response = client.get("/api/items/purchase-defaults")
        assert response.status_code == 200
        first = next(x for x in response.json() if x["item_id"] == item["id"])
        assert first["last_purchase_unit_id"] == thung["id"]
        assert first["last_purchase_unit_price"] == 240_000
        assert prices_by_unit(first) == {thung["id"]: 240_000, lon["id"]: 10_000}

        # The latest purchase may use a different unit; the next form should
        # still choose the item's default unit but price it correctly.
        create_purchase(
            client,
            supplier_id=supplier["id"],
            item_id=item["id"],
            unit_id=lon["id"],
            receipt_time="2026-10-03T08:00",
            quantity=12,
            unit_price=12_000,
        )
        response = client.get("/api/items/purchase-defaults")
        latest = next(x for x in response.json() if x["item_id"] == item["id"])
        assert latest["last_purchase_unit_id"] == lon["id"]
        assert latest["last_purchase_unit_price"] == 12_000
        assert latest["last_purchase_time"].startswith("2026-10-03")
        assert prices_by_unit(latest) == {thung["id"]: 288_000, lon["id"]: 12_000}


def test_purchase_defaults_available_when_tracking_stopped(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))
    with TestClient(app) as client:
        _, thung, lon, item, supplier = setup_inventory_master(client)
        create_purchase(
            client,
            supplier_id=supplier["id"],
            item_id=item["id"],
            unit_id=thung["id"],
            receipt_time="2026-10-01T10:00",
            quantity=1,
            unit_price=250_000,
        )
        response = client.patch(
            f"/api/items/{item['id']}/stock-tracking",
            json={"is_stock_tracked": False},
        )
        assert response.status_code == 200

        defaults = client.get("/api/items/purchase-defaults")
        assert defaults.status_code == 200
        row = next(x for x in defaults.json() if x["item_id"] == item["id"])
        assert row["default_unit_id"] == thung["id"]
        assert prices_by_unit(row)[thung["id"]] == 250_000
