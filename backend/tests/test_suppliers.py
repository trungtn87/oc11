from fastapi.testclient import TestClient

from backend.app.database import connect
from backend.app.main import app


def supplier_payload(name: str = "Hải sản Biển Đông", **overrides):
    return {
        "name": name,
        "phone": overrides.get("phone"),
        "address": overrides.get("address"),
        "note": overrides.get("note"),
        "bank_name": overrides.get("bank_name"),
        "bank_account_number": overrides.get("bank_account_number"),
        "bank_account_name": overrides.get("bank_account_name"),
        "payment_qr_image": overrides.get("payment_qr_image"),
    }


def test_create_and_list_supplier_with_optional_fields(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        created = client.post(
            "/api/suppliers",
            json=supplier_payload(
                phone="0912345678",
                address="Cao Bằng",
                bank_name="VCB",
                bank_account_number="123456789",
                bank_account_name="NGUYEN VAN A",
                payment_qr_image="data:image/png;base64,AAA",
            ),
        )

        assert created.status_code == 201
        body = created.json()
        assert body["name"] == "Hải sản Biển Đông"
        assert body["phone"] == "0912345678"
        assert body["payment_qr_image"] == "data:image/png;base64,AAA"
        assert body["can_delete"] is True

        response = client.get("/api/suppliers")
        assert response.status_code == 200
        assert len(response.json()) == 1


def test_only_name_is_required(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        created = client.post(
            "/api/suppliers",
            json=supplier_payload(name="  Nhà cung cấp A  "),
        )

        assert created.status_code == 201
        assert created.json()["name"] == "Nhà cung cấp A"

        blank = client.post(
            "/api/suppliers",
            json=supplier_payload(name="   "),
        )
        assert blank.status_code == 422


def test_update_supplier(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        supplier = client.post(
            "/api/suppliers",
            json=supplier_payload(name="NCC A"),
        ).json()

        updated = client.put(
            f"/api/suppliers/{supplier['id']}",
            json=supplier_payload(
                name="NCC A mới",
                note="Giao hàng buổi sáng",
                bank_name="BIDV",
            ),
        )

        assert updated.status_code == 200
        assert updated.json()["name"] == "NCC A mới"
        assert updated.json()["note"] == "Giao hàng buổi sáng"
        assert updated.json()["bank_name"] == "BIDV"


def test_delete_supplier_when_unlinked(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        supplier = client.post(
            "/api/suppliers",
            json=supplier_payload(name="NCC xóa được"),
        ).json()

        deleted = client.delete(f"/api/suppliers/{supplier['id']}")
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": True}
        assert client.get("/api/suppliers").json() == []


def test_delete_supplier_is_blocked_when_linked(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        supplier = client.post(
            "/api/suppliers",
            json=supplier_payload(name="NCC đã nhập hàng"),
        ).json()

        with connect() as connection:
            connection.execute(
                """
                CREATE TABLE purchase_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    supplier_id INTEGER NOT NULL,
                    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
                )
                """
            )
            connection.execute(
                "INSERT INTO purchase_orders (supplier_id) VALUES (?)",
                (supplier["id"],),
            )
            connection.commit()

        listed = client.get("/api/suppliers").json()
        assert listed[0]["can_delete"] is False

        deleted = client.delete(f"/api/suppliers/{supplier['id']}")
        assert deleted.status_code == 409
