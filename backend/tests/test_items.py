from fastapi.testclient import TestClient

from backend.app.main import app


def create_group(client: TestClient, name: str = "Hải sản"):
    return client.post(
        "/api/item-groups",
        json={"name": name, "note": None, "is_active": True},
    ).json()


def create_unit(client: TestClient, name: str = "kg"):
    return client.post(
        "/api/units",
        json={"name": name, "is_active": True},
    ).json()


def item_payload(group_id: int, unit_id: int, name: str = "Ốc hương", **overrides):
    return {
        "name": name,
        "item_type": overrides.get("item_type", "material"),
        "item_group_id": group_id,
        "unit_id": unit_id,
        "note": overrides.get("note"),
        "is_active": overrides.get("is_active", True),
    }


def test_create_and_list_inventory_item(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        unit = create_unit(client)

        created = client.post(
            "/api/items",
            json=item_payload(group["id"], unit["id"], note="Ốc sống"),
        )

        assert created.status_code == 201
        body = created.json()
        assert body["name"] == "Ốc hương"
        assert body["item_type"] == "material"
        assert body["item_group_name"] == "Hải sản"
        assert body["unit_name"] == "kg"

        listed = client.get("/api/items")
        assert listed.status_code == 200
        assert len(listed.json()) == 1


def test_item_name_is_unique_case_insensitive(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        unit = create_unit(client)

        first = client.post(
            "/api/items",
            json=item_payload(group["id"], unit["id"], name="Bia Tiger"),
        )
        duplicate = client.post(
            "/api/items",
            json=item_payload(group["id"], unit["id"], name="BIA TIGER"),
        )

        assert first.status_code == 201
        assert duplicate.status_code == 409


def test_support_direct_sale_type_and_update(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client, "Đồ uống")
        unit = create_unit(client, "lon")

        created = client.post(
            "/api/items",
            json=item_payload(
                group["id"],
                unit["id"],
                name="Bia Tiger lon",
                item_type="direct_sale",
            ),
        ).json()

        updated = client.put(
            f"/api/items/{created['id']}",
            json=item_payload(
                group["id"],
                unit["id"],
                name="Bia Tiger lon",
                item_type="direct_sale",
                note="Bán nguyên lon",
                is_active=False,
            ),
        )

        assert updated.status_code == 200
        assert updated.json()["item_type"] == "direct_sale"
        assert updated.json()["note"] == "Bán nguyên lon"
        assert updated.json()["is_active"] is False


def test_reject_missing_group_or_unit(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        unit = create_unit(client)

        missing_group = client.post(
            "/api/items",
            json=item_payload(999999, unit["id"]),
        )
        missing_unit = client.post(
            "/api/items",
            json=item_payload(group["id"], 999999, name="Ngao"),
        )

        assert missing_group.status_code == 422
        assert missing_unit.status_code == 422


def test_delete_item_is_not_supported(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        unit = create_unit(client)
        created = client.post(
            "/api/items",
            json=item_payload(group["id"], unit["id"]),
        ).json()

        response = client.delete(f"/api/items/{created['id']}")
        assert response.status_code == 405
