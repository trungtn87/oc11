import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import app


def setup_inventory_master(client: TestClient):
    group = client.post(
        "/api/item-groups",
        json={"name": "Đồ uống", "note": None, "is_active": True},
    ).json()
    thung = client.post(
        "/api/units",
        json={"name": "thùng", "is_active": True},
    ).json()
    lon = client.post(
        "/api/units",
        json={"name": "lon", "is_active": True},
    ).json()
    item = client.post(
        "/api/items",
        json={
            "name": "Bia Hà Nội",
            "item_group_id": group["id"],
            "default_unit_id": thung["id"],
            "smallest_unit_id": lon["id"],
            "note": None,
            "is_active": True,
            "conversions": [
                {
                    "unit_id": thung["id"],
                    "quantity_in_smallest_unit": 24,
                    "is_active": True,
                }
            ],
        },
    ).json()
    supplier = client.post(
        "/api/suppliers",
        json={"name": "Nhà cung cấp bia"},
    ).json()
    return group, thung, lon, item, supplier


def create_purchase(
    client: TestClient,
    *,
    supplier_id: int,
    item_id: int,
    unit_id: int,
    receipt_time: str,
    quantity: float,
    unit_price: int,
):
    response = client.post(
        "/api/purchase-receipts",
        json={
            "supplier_id": supplier_id,
            "receipt_time": receipt_time,
            "description": None,
            "shipping_fee": 0,
            "payment_status": "DEBT",
            "payment": None,
            "items": [
                {
                    "item_id": item_id,
                    "unit_id": unit_id,
                    "quantity": quantity,
                    "unit_price": unit_price,
                    "note": None,
                }
            ],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_stock_list_uses_smallest_unit_and_latest_purchase_price(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group, thung, _, item, supplier = setup_inventory_master(client)
        receipt = create_purchase(
            client,
            supplier_id=supplier["id"],
            item_id=item["id"],
            unit_id=thung["id"],
            receipt_time="2026-10-01T08:00",
            quantity=5,
            unit_price=240_000,
        )

        response = client.get("/api/inventory/stock")
        assert response.status_code == 200
        row = next(
            stock for stock in response.json()
            if stock["item_id"] == item["id"]
        )

        assert row["item_group_id"] == group["id"]
        assert row["smallest_unit_name"] == "lon"
        assert row["stock_quantity"] == 120
        assert row["last_purchase_receipt_code"] == receipt["receipt_code"]
        assert row["last_purchase_unit_name"] == "thùng"
        assert row["last_purchase_unit_price"] == 240_000
        assert row["last_purchase_price_per_smallest_unit"] == 10_000
        assert row["last_purchase_conversion_factor"] == 24
        assert row["default_unit_name"] == "thùng"
        assert row["default_unit_conversion_factor"] == 24


def test_stock_uses_unit_from_latest_non_void_purchase_at_requested_date(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        _, thung, lon, item, supplier = setup_inventory_master(client)
        create_purchase(
            client, supplier_id=supplier["id"], item_id=item["id"],
            unit_id=thung["id"], receipt_time="2026-10-01T08:00",
            quantity=5, unit_price=240_000,
        )
        create_purchase(
            client, supplier_id=supplier["id"], item_id=item["id"],
            unit_id=lon["id"], receipt_time="2026-10-04T09:00",
            quantity=10, unit_price=12_000,
        )

        old = client.get("/api/inventory/stock", params={"as_of": "2026-10-02"}).json()
        previous = next(row for row in old if row["item_id"] == item["id"])
        assert previous["stock_quantity"] == 120
        assert previous["last_purchase_unit_name"] == "thùng"
        assert previous["last_purchase_conversion_factor"] == 24
        assert previous["last_purchase_price_per_smallest_unit"] == 10_000

        current = client.get("/api/inventory/stock").json()
        latest = next(row for row in current if row["item_id"] == item["id"])
        assert latest["stock_quantity"] == 130
        assert latest["last_purchase_unit_name"] == "lon"
        assert latest["last_purchase_conversion_factor"] == 1
        assert latest["last_purchase_price_per_smallest_unit"] == 12_000


def test_stock_shortage_has_default_purchase_unit_fallback_when_never_purchased(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        _, thung, lon, item, _ = setup_inventory_master(client)
        with sqlite3.connect(db_path) as connection:
            connection.execute(
                """
                INSERT INTO inventory_movements (
                    item_id, movement_time, quantity_delta,
                    source_type, source_id, source_line_id, note
                ) VALUES (?, '2026-10-07T12:00:00', -36, 'SALE',
                          'seed-negative', 'line-negative', 'Negative stock')
                """,
                (item["id"],),
            )
            connection.commit()

        response = client.get("/api/inventory/stock", params={"tracking": "TRACKED"})
        assert response.status_code == 200, response.text
        row = next(stock for stock in response.json() if stock["item_id"] == item["id"])
        assert row["stock_quantity"] == -36  # always smallest units internally
        assert row["smallest_unit_name"] == "lon"
        assert row["default_unit_name"] == "thùng"
        assert row["default_unit_conversion_factor"] == 24
        assert row["last_purchase_unit_name"] is None
        assert row["last_purchase_conversion_factor"] is None
        # Dashboard renders -36 / 24 = -1.5 thùng, not -36 lon.

        # No history should never fabricate a latest purchase price.
        assert row["last_purchase_unit_price"] is None
        assert row["last_purchase_price_per_smallest_unit"] is None


def test_inventory_history_calculates_opening_sales_adjustment_and_closing(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        _, thung, _, item, supplier = setup_inventory_master(client)
        create_purchase(
            client,
            supplier_id=supplier["id"],
            item_id=item["id"],
            unit_id=thung["id"],
            receipt_time="2026-10-01T08:00",
            quantity=5,
            unit_price=240_000,
        )

        with sqlite3.connect(db_path) as connection:
            connection.execute(
                """
                INSERT INTO inventory_movements (
                    item_id,
                    movement_time,
                    quantity_delta,
                    source_type,
                    source_id,
                    source_line_id,
                    note
                )
                VALUES (?, '2026-10-02T20:00', -20, 'SALE', 'HD000001', 'LINE-1', 'Bán hàng')
                """,
                (item["id"],),
            )
            connection.commit()

        adjusted = client.post(
            "/api/inventory/adjustments",
            json={
                "item_id": item["id"],
                "actual_quantity": 95,
                "adjustment_time": "2026-10-02T21:00",
                "reason": "Đối chiếu cuối ngày",
                "note": "Đếm thực tế",
            },
        )
        assert adjusted.status_code == 201
        adjustment = adjusted.json()
        assert adjustment["system_quantity"] == 100
        assert adjustment["actual_quantity"] == 95
        assert adjustment["quantity_delta"] == -5

        response = client.get(
            f"/api/inventory/items/{item['id']}/history",
            params={
                "from": "2026-10-02",
                "to": "2026-10-02",
                "type": "ALL",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["summary"]["opening_quantity"] == 120
        assert body["summary"]["purchase_delta"] == 0
        assert body["summary"]["sales_delta"] == -20
        assert body["summary"]["adjustment_delta"] == -5
        assert body["summary"]["closing_quantity"] == 95
        assert [row["movement_kind"] for row in body["items"]] == [
            "SALE",
            "ADJUSTMENT",
        ]
        assert [row["running_quantity"] for row in body["items"]] == [100, 95]
        assert body["items"][0]["reference_code"] == "HD000001"
        assert body["items"][1]["reference_code"] == adjustment["adjustment_code"]

        sale_only = client.get(
            f"/api/inventory/items/{item['id']}/history",
            params={
                "from": "2026-10-02",
                "to": "2026-10-02",
                "type": "SALE",
            },
        )
        assert sale_only.status_code == 200
        filtered = sale_only.json()
        assert len(filtered["items"]) == 1
        assert filtered["items"][0]["movement_kind"] == "SALE"
        assert filtered["items"][0]["running_quantity"] == 100
        assert filtered["summary"]["closing_quantity"] == 95

        stock = client.get("/api/inventory/stock").json()
        row = next(x for x in stock if x["item_id"] == item["id"])
        assert row["stock_quantity"] == 95
        assert row["last_reconciled_quantity"] == 95
        assert row["last_reconciled_at"].startswith("2026-10-02T21:00")


def test_inventory_stock_as_of_excludes_later_movements(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        _, thung, _, item, supplier = setup_inventory_master(client)
        create_purchase(
            client,
            supplier_id=supplier["id"],
            item_id=item["id"],
            unit_id=thung["id"],
            receipt_time="2026-10-01T08:00",
            quantity=5,
            unit_price=240_000,
        )

        with sqlite3.connect(db_path) as connection:
            connection.execute(
                """
                INSERT INTO inventory_movements (
                    item_id,
                    movement_time,
                    quantity_delta,
                    source_type,
                    source_id,
                    source_line_id,
                    note
                )
                VALUES (?, '2026-10-02T12:00', -30, 'SALE', 'HD000002', 'LINE-1', 'Bán hàng')
                """,
                (item["id"],),
            )
            connection.commit()

        response = client.get(
            "/api/inventory/stock",
            params={"as_of": "2026-10-01"},
        )
        assert response.status_code == 200
        row = next(
            stock for stock in response.json()
            if stock["item_id"] == item["id"]
        )
        assert row["stock_quantity"] == 120


def test_reconciliation_records_checkpoint_even_without_difference(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        _, thung, _, item, supplier = setup_inventory_master(client)
        create_purchase(
            client,
            supplier_id=supplier["id"],
            item_id=item["id"],
            unit_id=thung["id"],
            receipt_time="2026-10-01T08:00",
            quantity=1,
            unit_price=240_000,
        )

        response = client.post(
            "/api/inventory/adjustments",
            json={
                "item_id": item["id"],
                "actual_quantity": 24,
                "adjustment_time": "2026-10-01T20:00",
            },
        )
        assert response.status_code == 201
        assert response.json()["quantity_delta"] == 0

        history = client.get(
            f"/api/inventory/items/{item['id']}/history",
            params={
                "from": "2026-10-01",
                "to": "2026-10-01",
                "type": "ADJUSTMENT",
            },
        ).json()
        assert len(history["items"]) == 1
        assert history["items"][0]["quantity_delta"] == 0
        assert history["items"][0]["running_quantity"] == 24
