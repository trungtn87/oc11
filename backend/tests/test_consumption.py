from fastapi.testclient import TestClient

from backend.app.consumption import record_sale_consumption
from backend.app.database import connect
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


def create_item(client: TestClient, name: str, group_id: int, kg_id: int, g_id: int):
    response = client.post(
        "/api/items",
        json={
            "name": name,
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


def build_menu(client: TestClient):
    kg = create_unit(client, "kg")
    gram = create_unit(client, "g")
    plate = create_unit(client, "đĩa")

    seafood = create_group(client, "Hải sản")
    sauce_group = create_group(client, "Nguyên liệu sốt")

    snail = create_item(client, "Ốc hương", seafood["id"], kg["id"], gram["id"])
    butter = create_item(client, "Bơ", sauce_group["id"], kg["id"], gram["id"])

    option = client.post(
        "/api/cost/service-options",
        json={
            "name": "Trứng muối",
            "note": None,
            "display_order": 1,
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
    assert option.status_code == 201
    option_body = option.json()

    menu_group = client.post(
        "/api/menu/groups",
        json={
            "name": "Ốc",
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
            "base_price": 150000,
            "display_order": 1,
            "is_active": True,
            "note": None,
            "options": [
                {
                    "service_option_id": option_body["id"],
                    "extra_price": 20000,
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
                        },
                        {
                            "component_type": "RECIPE",
                            "item_id": None,
                            "unit_id": None,
                            "recipe_id": option_body["recipe"]["id"],
                            "quantity": 120,
                        },
                    ],
                }
            ],
        },
    )
    assert menu_item.status_code == 201

    return {
        "snail": snail,
        "butter": butter,
        "menu_option_id": menu_item.json()["options"][0]["id"],
    }


def test_preview_bungs_two_tier_recipe_to_raw_inventory(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        data = build_menu(client)

        response = client.post(
            "/api/inventory/consumption/preview",
            json={
                "menu_item_option_id": data["menu_option_id"],
                "quantity": 2,
            },
        )

        assert response.status_code == 200
        body = response.json()
        quantities = {row["item_name"]: row["quantity"] for row in body["items"]}
        assert quantities["Ốc hương"] == 1000
        assert quantities["Bơ"] == 240


def test_sale_consumption_is_idempotent_and_reported(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        data = build_menu(client)

        with connect() as connection:
            record_sale_consumption(
                connection,
                source_id="HD000001",
                source_line_id="1",
                movement_time="2026-10-05T12:00:00",
                menu_item_option_id=data["menu_option_id"],
                sold_quantity=2,
            )
            connection.commit()

        response = client.get(
            "/api/inventory/consumption",
            params={"from": "2026-10-05", "to": "2026-10-05"},
        )
        assert response.status_code == 200
        rows = {row["item_name"]: row for row in response.json()["items"]}
        assert rows["Ốc hương"]["consumed_quantity"] == 1000
        assert rows["Bơ"]["consumed_quantity"] == 240
        assert rows["Ốc hương"]["sale_line_count"] == 1

        with connect() as connection:
            record_sale_consumption(
                connection,
                source_id="HD000001",
                source_line_id="1",
                movement_time="2026-10-05T12:00:00",
                menu_item_option_id=data["menu_option_id"],
                sold_quantity=1,
            )
            connection.commit()

        response = client.get(
            "/api/inventory/consumption",
            params={"from": "2026-10-05", "to": "2026-10-05"},
        )
        assert response.status_code == 200
        rows = {row["item_name"]: row for row in response.json()["items"]}
        assert rows["Ốc hương"]["consumed_quantity"] == 500
        assert rows["Bơ"]["consumed_quantity"] == 120
        assert rows["Ốc hương"]["sale_line_count"] == 1
