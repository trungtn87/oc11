from fastapi.testclient import TestClient

from backend.app.main import app


def create_unit(client: TestClient, name: str):
    response = client.post("/api/units", json={"name": name, "is_active": True})
    assert response.status_code == 201
    return response.json()


def create_group(client: TestClient):
    response = client.post(
        "/api/item-groups",
        json={"name": "Nguyên liệu sốt", "note": None, "is_active": True},
    )
    assert response.status_code == 201
    return response.json()


def create_item(client: TestClient, group_id: int, kg_id: int, g_id: int):
    response = client.post(
        "/api/items",
        json={
            "name": "Bơ",
            "item_group_id": group_id,
            "default_unit_id": kg_id,
            "smallest_unit_id": g_id,
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
            "name": "NCC test",
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


def create_purchase(
    client: TestClient,
    supplier_id: int,
    item_id: int,
    unit_id: int,
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
                    "unit_id": unit_id,
                    "quantity": 1,
                    "unit_price": unit_price,
                    "note": None,
                }
            ],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_service_option_can_exist_without_recipe(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        response = client.post(
            "/api/cost/service-options",
            json={
                "name": "Hấp",
                "note": None,
                "display_order": 1,
                "is_active": True,
                "recipe": None,
            },
        )

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Hấp"
        assert body["recipe"] is None


def test_recipe_cost_and_alert_when_ingredient_price_increases(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        kg = create_unit(client, "kg")
        gram = create_unit(client, "g")
        portion = create_unit(client, "phần")
        item = create_item(client, group["id"], kg["id"], gram["id"])
        supplier = create_supplier(client)

        create_purchase(
            client,
            supplier["id"],
            item["id"],
            kg["id"],
            100_000,
            "2026-10-01T08:00:00",
        )

        option = client.post(
            "/api/cost/service-options",
            json={
                "name": "Bơ tỏi",
                "note": None,
                "display_order": 1,
                "is_active": True,
                "recipe": {
                    "output_quantity": 1,
                    "output_unit_id": portion["id"],
                    "waste_percent": 5,
                    "alert_threshold_percent": 5,
                    "is_active": True,
                    "items": [
                        {
                            "item_id": item["id"],
                            "unit_id": gram["id"],
                            "quantity": 100,
                        }
                    ],
                },
            },
        )

        assert option.status_code == 201
        recipe = option.json()["recipe"]
        assert recipe["cost_complete"] is True
        assert round(recipe["base_cost"], 2) == 10_000
        assert round(recipe["total_cost"], 2) == 10_500
        assert round(recipe["current_unit_cost"], 2) == 10_500
        assert round(recipe["reference_unit_cost"], 2) == 10_500

        create_purchase(
            client,
            supplier["id"],
            item["id"],
            kg["id"],
            120_000,
            "2026-10-02T08:00:00",
        )

        alerts = client.get("/api/cost/alerts")
        assert alerts.status_code == 200
        rows = alerts.json()
        assert len(rows) == 1
        assert rows[0]["service_option_name"] == "Bơ tỏi"
        assert round(rows[0]["current_unit_cost"], 2) == 12_600
        assert round(rows[0]["change_percent"], 2) == 20

        accepted = client.post(
            f"/api/cost/recipes/{recipe['id']}/accept-current-cost"
        )
        assert accepted.status_code == 200
        assert round(accepted.json()["reference_unit_cost"], 2) == 12_600

        alerts_after = client.get("/api/cost/alerts")
        assert alerts_after.status_code == 200
        assert alerts_after.json() == []
