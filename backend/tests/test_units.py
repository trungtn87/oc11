from fastapi.testclient import TestClient

from backend.app.main import app


def create_unit(client: TestClient, name: str, is_active: bool = True):
    return client.post(
        "/api/units",
        json={"name": name, "is_active": is_active},
    )


def test_create_and_list_units(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        created = create_unit(client, "kg")

        assert created.status_code == 201
        assert created.json()["name"] == "kg"
        assert created.json()["is_active"] is True

        units = client.get("/api/units")
        assert units.status_code == 200
        assert len(units.json()) == 1


def test_unit_name_is_unique_without_case_sensitivity(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        first = create_unit(client, "Lon")
        duplicate = create_unit(client, "LON")

        assert first.status_code == 201
        assert duplicate.status_code == 409


def test_update_unit_and_change_status(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        created = create_unit(client, "Chai").json()

        updated = client.put(
            f"/api/units/{created['id']}",
            json={"name": "Chai", "is_active": False},
        )

        assert updated.status_code == 200
        assert updated.json()["name"] == "Chai"
        assert updated.json()["is_active"] is False


def test_delete_unit_is_not_supported(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        created = create_unit(client, "Con").json()
        response = client.delete(f"/api/units/{created['id']}")

        assert response.status_code == 405
