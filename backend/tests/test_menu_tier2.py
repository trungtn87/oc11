from fastapi.testclient import TestClient

from backend.app.main import app


def create_unit(client: TestClient, name: str):
    response = client.post("/api/units", json={"name": name, "is_active": True})
    assert response.status_code == 201
    return response.json()


def create_group(client: TestClient, name: str):
    response = client.post(
        "/api/item-groups",
        json={"name": name, "note": None, "is_active": True},
    )
    assert response.status_code == 201
    return response.json()


def create_item(
    client: TestClient,
    *,
    name: str,
    group_id: int,
    kg_id: int,
    gram_id: int,
):
    response = client.post(
        "/api/items",
        json={
            "name": name,
            "item_group_id": group_id,
            "default_unit_id": kg_id,
            "smallest_unit_id": gram_id,
            "note": None,
            "is_active": True,
            "conversions": [
                {
                    "unit_id": kg_id,
                    "quantity_in_smallest_unit": 1000,
                    "is_active": True,
                }
            ],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_supplier(client: TestClient):
    response = client.post(
        "/api/suppliers",
        json={
            "name": "NCC menu test",
            "phone": None,
            "address": None,
            "note": None,
            "bank_name": None,
            "bank_account_number": None,
            "bank_account_name": None,
            "payment_qr_image": None,
        },
    )
    assert response.status_code == 201
    return response.json()


def purchase(
    client: TestClient,
    *,
    supplier_id: int,
    item_id: int,
    kg_id: int,
    unit_price: int,
    receipt_time: str,
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
                    "unit_id": kg_id,
                    "quantity": 1,
                    "unit_price": unit_price,
                    "note": None,
                }
            ],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_menu_tier_2_uses_raw_item_and_sauce_recipe(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        kg = create_unit(client, "kg")
        gram = create_unit(client, "g")
        plate = create_unit(client, "đĩa")

        seafood = create_group(client, "Hải sản")
        sauce_group = create_group(client, "Nguyên liệu sốt")

        snail = create_item(
            client,
            name="Ốc hương",
            group_id=seafood["id"],
            kg_id=kg["id"],
            gram_id=gram["id"],
        )
        butter = create_item(
            client,
            name="Bơ",
            group_id=sauce_group["id"],
            kg_id=kg["id"],
            gram_id=gram["id"],
        )

        supplier = create_supplier(client)
        purchase(
            client,
            supplier_id=supplier["id"],
            item_id=snail["id"],
            kg_id=kg["id"],
            unit_price=150_000,
            receipt_time="2026-10-01T08:00:00",
        )
        purchase(
            client,
            supplier_id=supplier["id"],
            item_id=butter["id"],
            kg_id=kg["id"],
            unit_price=100_000,
            receipt_time="2026-10-01T08:10:00",
        )

        hap = client.post(
            "/api/cost/service-options",
            json={
                "name": "Hấp",
                "note": None,
                "display_order": 1,
                "is_active": True,
                "recipe": None,
            },
        )
        assert hap.status_code == 201

        salted = client.post(
            "/api/cost/service-options",
            json={
                "name": "Trứng muối",
                "note": None,
                "display_order": 2,
                "is_active": True,
                "recipe": {
                    "output_quantity": 1000,
                    "output_unit_id": gram["id"],
                    "waste_percent": 0,
                    "alert_threshold_percent": 5,
                    "is_active": True,
                    "items": [
                        {
                            "item_id": butter["id"],
                            "unit_id": gram["id"],
                            "quantity": 1000,
                        }
                    ],
                },
            },
        )
        assert salted.status_code == 201
        salted_body = salted.json()
        recipe_id = salted_body["recipe"]["id"]
        assert round(salted_body["recipe"]["current_unit_cost"], 2) == 100

        menu_group = client.post(
            "/api/menu/groups",
            json={
                "name": "Ốc hương",
                "display_order": 1,
                "is_active": True,
                "note": None,
            },
        )
        assert menu_group.status_code == 201

        menu_item = client.post(
            "/api/menu/items",
            json={
                "name": "Ốc hương",
                "menu_group_id": menu_group.json()["id"],
                "sale_unit_id": plate["id"],
                "base_price": 150_000,
                "display_order": 1,
                "is_active": True,
                "note": None,
                "options": [
                    {
                        "service_option_id": hap.json()["id"],
                        "extra_price": 0,
                        "alert_threshold_percent": 5,
                        "display_order": 1,
                        "is_active": True,
                        "components": [
                            {
                                "component_type": "ITEM",
                                "item_id": snail["id"],
                                "unit_id": gram["id"],
                                "recipe_id": None,
                                "quantity": 500,
                            }
                        ],
                    },
                    {
                        "service_option_id": salted_body["id"],
                        "extra_price": 20_000,
                        "alert_threshold_percent": 5,
                        "display_order": 2,
                        "is_active": True,
                        "components": [
                            {
                                "component_type": "ITEM",
                                "item_id": snail["id"],
                                "unit_id": gram["id"],
                                "recipe_id": None,
                                "quantity": 500,
                            },
                            {
                                "component_type": "RECIPE",
                                "item_id": None,
                                "unit_id": None,
                                "recipe_id": recipe_id,
                                "quantity": 120,
                            },
                        ],
                    },
                ],
            },
        )
        assert menu_item.status_code == 201
        body = menu_item.json()
        assert body["base_price"] == 150_000
        assert len(body["options"]) == 2

        by_name = {row["service_option_name"]: row for row in body["options"]}
        assert round(by_name["Hấp"]["current_cost"], 2) == 75_000
        assert by_name["Hấp"]["sale_price"] == 150_000
        assert round(by_name["Trứng muối"]["current_cost"], 2) == 87_000
        assert by_name["Trứng muối"]["sale_price"] == 170_000
        assert round(by_name["Trứng muối"]["cost_percent"], 2) == 51.18

        purchase(
            client,
            supplier_id=supplier["id"],
            item_id=snail["id"],
            kg_id=kg["id"],
            unit_price=180_000,
            receipt_time="2026-10-02T08:00:00",
        )

        alerts = client.get("/api/menu/alerts")
        assert alerts.status_code == 200
        alert_rows = alerts.json()
        assert len(alert_rows) == 2

        salted_alert = next(
            row for row in alert_rows if row["service_option_name"] == "Trứng muối"
        )
        assert round(salted_alert["reference_cost"], 2) == 87_000
        assert round(salted_alert["current_cost"], 2) == 102_000
        assert round(salted_alert["change_percent"], 2) == 17.24

        accepted = client.post(
            f"/api/menu/item-options/{salted_alert['menu_item_option_id']}/accept-current-cost"
        )
        assert accepted.status_code == 200
        assert round(accepted.json()["reference_cost"], 2) == 102_000


def test_menu_group_name_is_case_insensitive_unique(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        first = client.post(
            "/api/menu/groups",
            json={
                "name": "Ốc hương",
                "display_order": 1,
                "is_active": True,
                "note": None,
            },
        )
        assert first.status_code == 201

        duplicate = client.post(
            "/api/menu/groups",
            json={
                "name": "ốc HƯƠNG",
                "display_order": 2,
                "is_active": True,
                "note": None,
            },
        )
        assert duplicate.status_code == 409
