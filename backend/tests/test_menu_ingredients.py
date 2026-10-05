from fastapi.testclient import TestClient

from backend.app.main import app


def test_menu_base_ingredient_can_be_used_without_cooking_option(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        kg = client.post(
            "/api/units", json={"name": "kg", "is_active": True}
        ).json()
        gram = client.post(
            "/api/units", json={"name": "g", "is_active": True}
        ).json()
        plate = client.post(
            "/api/units", json={"name": "đĩa", "is_active": True}
        ).json()

        group_response = client.post(
            "/api/item-groups",
            json={"name": "Hải sản", "note": None, "is_active": True},
        )
        assert group_response.status_code == 201
        group = group_response.json()

        item_response = client.post(
            "/api/items",
            json={
                "name": "Mực tươi",
                "item_group_id": group["id"],
                "default_unit_id": kg["id"],
                "smallest_unit_id": gram["id"],
                "note": None,
                "is_active": True,
                "conversions": [
                    {
                        "unit_id": kg["id"],
                        "quantity_in_smallest_unit": 1000,
                        "is_active": True,
                    }
                ],
            },
        )
        assert item_response.status_code == 201
        squid = item_response.json()

        menu_group_response = client.post(
            "/api/menu/groups",
            json={
                "name": "Mực",
                "display_order": 1,
                "is_active": True,
                "note": None,
            },
        )
        assert menu_group_response.status_code == 201
        menu_group = menu_group_response.json()

        create_response = client.post(
            "/api/menu/items",
            json={
                "name": "Mực hấp",
                "menu_group_id": menu_group["id"],
                "sale_unit_id": plate["id"],
                "base_price": 150000,
                "display_order": 1,
                "is_active": True,
                "note": None,
                "ingredients": [
                    {
                        "item_id": squid["id"],
                        "unit_id": gram["id"],
                        "quantity": 500,
                    }
                ],
                "options": [],
            },
        )
        assert create_response.status_code == 201
        menu_item = create_response.json()
        assert len(menu_item["ingredients"]) == 1
        assert menu_item["ingredients"][0]["item_name"] == "Mực tươi"
        assert menu_item["ingredients"][0]["quantity"] == 500

        direct_preview = client.post(
            "/api/inventory/consumption/preview",
            json={"menu_item_id": menu_item["id"], "quantity": 2},
        )
        assert direct_preview.status_code == 200
        direct_body = direct_preview.json()
        assert direct_body["menu_item_option_id"] is None
        assert direct_body["items"][0]["item_name"] == "Mực tươi"
        assert direct_body["items"][0]["quantity"] == 1000

        option_response = client.post(
            "/api/cost/service-options",
            json={
                "name": "Hấp",
                "note": None,
                "display_order": 1,
                "is_active": True,
                "recipe": None,
            },
        )
        assert option_response.status_code == 201
        option = option_response.json()

        update_response = client.put(
            f"/api/menu/items/{menu_item['id']}",
            json={
                "name": "Mực hấp",
                "menu_group_id": menu_group["id"],
                "sale_unit_id": plate["id"],
                "base_price": 150000,
                "display_order": 1,
                "is_active": True,
                "note": None,
                "ingredients": [
                    {
                        "item_id": squid["id"],
                        "unit_id": gram["id"],
                        "quantity": 500,
                    }
                ],
                "options": [
                    {
                        "service_option_id": option["id"],
                        "extra_price": 0,
                        "display_order": 1,
                        "is_active": True,
                        "components": [],
                    }
                ],
            },
        )
        assert update_response.status_code == 200
        updated = update_response.json()
        assert len(updated["options"]) == 1

        option_preview = client.post(
            "/api/inventory/consumption/preview",
            json={
                "menu_item_option_id": updated["options"][0]["id"],
                "quantity": 1,
            },
        )
        assert option_preview.status_code == 200
        option_body = option_preview.json()
        assert option_body["service_option_name"] == "Hấp"
        assert option_body["items"][0]["item_name"] == "Mực tươi"
        assert option_body["items"][0]["quantity"] == 500



def test_menu_without_cooking_option_alerts_at_three_percent(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11-alert.db"))

    with TestClient(app) as client:
        kg = client.post(
            "/api/units", json={"name": "kg", "is_active": True}
        ).json()
        gram = client.post(
            "/api/units", json={"name": "g", "is_active": True}
        ).json()
        plate = client.post(
            "/api/units", json={"name": "đĩa", "is_active": True}
        ).json()

        group = client.post(
            "/api/item-groups",
            json={"name": "Hải sản", "note": None, "is_active": True},
        ).json()
        squid = client.post(
            "/api/items",
            json={
                "name": "Mực tươi",
                "item_group_id": group["id"],
                "default_unit_id": kg["id"],
                "smallest_unit_id": gram["id"],
                "note": None,
                "is_active": True,
                "conversions": [
                    {
                        "unit_id": kg["id"],
                        "quantity_in_smallest_unit": 1000,
                        "is_active": True,
                    }
                ],
            },
        ).json()
        supplier = client.post(
            "/api/suppliers",
            json={
                "name": "NCC mực",
                "phone": None,
                "address": None,
                "note": None,
                "bank_name": None,
                "bank_account_number": None,
                "bank_account_name": None,
                "payment_qr_image": None,
            },
        ).json()

        first_purchase = client.post(
            "/api/purchase-receipts",
            json={
                "supplier_id": supplier["id"],
                "receipt_time": "2026-10-01T08:00:00",
                "description": None,
                "shipping_fee": 0,
                "payment_status": "DEBT",
                "payment": None,
                "items": [
                    {
                        "item_id": squid["id"],
                        "unit_id": kg["id"],
                        "quantity": 1,
                        "unit_price": 100000,
                        "note": None,
                    }
                ],
            },
        )
        assert first_purchase.status_code == 201

        menu_group = client.post(
            "/api/menu/groups",
            json={
                "name": "Mực",
                "display_order": 1,
                "is_active": True,
                "note": None,
            },
        ).json()
        menu_item_response = client.post(
            "/api/menu/items",
            json={
                "name": "Mực hấp",
                "menu_group_id": menu_group["id"],
                "sale_unit_id": plate["id"],
                "base_price": 150000,
                "display_order": 1,
                "is_active": True,
                "note": None,
                "ingredients": [
                    {
                        "item_id": squid["id"],
                        "unit_id": gram["id"],
                        "quantity": 500,
                    }
                ],
                "options": [],
            },
        )
        assert menu_item_response.status_code == 201
        menu_item = menu_item_response.json()
        assert menu_item["alert_threshold_percent"] == 3
        assert round(menu_item["reference_cost"], 2) == 50000

        second_purchase = client.post(
            "/api/purchase-receipts",
            json={
                "supplier_id": supplier["id"],
                "receipt_time": "2026-10-02T08:00:00",
                "description": None,
                "shipping_fee": 0,
                "payment_status": "DEBT",
                "payment": None,
                "items": [
                    {
                        "item_id": squid["id"],
                        "unit_id": kg["id"],
                        "quantity": 1,
                        "unit_price": 104000,
                        "note": None,
                    }
                ],
            },
        )
        assert second_purchase.status_code == 201

        alerts = client.get("/api/menu/alerts")
        assert alerts.status_code == 200
        rows = alerts.json()
        assert len(rows) == 1
        assert rows[0]["menu_item_id"] == menu_item["id"]
        assert round(rows[0]["reference_cost"], 2) == 50000
        assert round(rows[0]["current_cost"], 2) == 52000
        assert round(rows[0]["change_percent"], 2) == 4
        assert rows[0]["alert_threshold_percent"] == 3

        menu_rows = client.get("/api/menu/items")
        assert menu_rows.status_code == 200
        matching = next(
            row for row in menu_rows.json()
            if row["id"] == menu_item["id"]
        )
        assert matching["has_open_alert"] is True
