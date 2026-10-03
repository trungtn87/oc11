from fastapi.testclient import TestClient

from backend.app.main import app


def create_group(client: TestClient, name: str, **overrides):
    payload = {
        "name": name,
        "note": overrides.get("note"),
        "is_active": overrides.get("is_active", True),
    }
    return client.post("/api/item-groups", json=payload)


def test_create_and_list_item_groups(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        response = create_group(client, "Hải sản", note="Nguyên liệu tươi sống")

        assert response.status_code == 201
        assert response.json()["name"] == "Hải sản"
        assert response.json()["is_active"] is True

        groups = client.get("/api/item-groups")
        assert groups.status_code == 200
        assert len(groups.json()) == 1


def test_name_is_unique_without_case_sensitivity(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        first = create_group(client, "Hải sản")
        duplicate = create_group(client, "HẢI SẢN")

        assert first.status_code == 201
        assert duplicate.status_code == 409


def test_update_group_and_change_status(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        created = create_group(client, "Bia").json()

        updated = client.put(
            f"/api/item-groups/{created['id']}",
            json={
                "name": "Bia",
                "note": "Bia lon, bia chai",
                "is_active": False,
            },
        )

        assert updated.status_code == 200
        assert updated.json()["note"] == "Bia lon, bia chai"
        assert updated.json()["is_active"] is False


def test_delete_is_not_supported(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        created = create_group(client, "Gia vị").json()
        response = client.delete(f"/api/item-groups/{created['id']}")

        assert response.status_code == 405
