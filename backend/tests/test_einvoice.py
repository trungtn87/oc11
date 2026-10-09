"""Regression coverage: prepare HĐĐT without ever publishing via MISA."""
import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.tests.test_sales import seed_sale_data


def _create_paid_order(client, ids, *, customer_id=None, request_einvoice=False):
    created = client.post(
        "/api/sales/orders",
        json={"items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}]},
    )
    assert created.status_code == 201, created.text
    order = created.json()
    paid = client.post(
        f"/api/sales/orders/{order['id']}/pay",
        json={
            "fund_account_id": ids["fund_account_id"],
            "actual_received_amount": order["total_amount"],
            "customer_id": customer_id,
            "request_einvoice": request_einvoice,
        },
    )
    assert paid.status_code == 200, paid.text
    return paid.json()


def test_einvoice_settings_are_nonsecret_and_never_activate_issuer(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        initial = client.get("/api/einvoice/settings")
        assert initial.status_code == 200
        assert initial.json()["issuance_source"] == "CUKCUK"
        assert initial.json()["live_enabled"] is False
        update = client.put(
            "/api/einvoice/settings",
            json={
                "environment": "PRODUCTION",
                "company_tax_code": "4800123456",
                "invoice_series": "1C26TAA",
            },
        )
        assert update.status_code == 200
        assert update.json()["environment"] == "PRODUCTION"
        assert update.json()["issuance_source"] == "CUKCUK"
        assert update.json()["live_enabled"] is False
        assert "access_token" not in update.json()
        assert client.put(
            "/api/einvoice/settings",
            json={"issuance_source": "OC11", "live_enabled": True},
        ).status_code == 422
        assert client.post("/api/einvoice/publish", json={}).status_code == 404
    with sqlite3.connect(db_path) as connection:
        assert connection.execute(
            "SELECT company_tax_code FROM einvoice_integration_settings"
        ).fetchone()[0] == "4800123456"


def test_einvoice_draft_created_once_after_paid_sale_and_preview(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        ids = seed_sale_data(db_path)
        customer = client.post(
            "/api/pos/customers",
            json={
                "customer_type": "ORGANIZATION",
                "name": "Khách thử",
                "tax_code": "0101234567",
                "address": "Cao Bằng",
            },
        )
        assert customer.status_code == 201, customer.text
        order = _create_paid_order(client, ids, customer_id=customer.json()["id"])
        rows = client.get("/api/einvoice/orders").json()
        assert len(rows) == 1
        assert rows[0]["invoice_status"] == "NOT_REQUESTED"

        first = client.post(f"/api/einvoice/orders/{order['id']}/request")
        assert first.status_code == 201, first.text
        assert first.json()["sent_to_misa"] is False
        duplicate = client.post(f"/api/einvoice/orders/{order['id']}/request")
        assert duplicate.status_code == 409
        preview = client.get(f"/api/einvoice/orders/{order['id']}/preview")
        assert preview.status_code == 200
        data = preview.json()
        assert data["customer"]["tax_code"] == "0101234567"
        assert data["total_amount"] == order["total_amount"]
        assert data["items"][0]["item_name_snapshot"] == "Mực hấp"
        assert data["can_publish"] is False
        assert data["warnings"]
        rows_after = client.get("/api/einvoice/orders").json()
        assert rows_after[0]["invoice_status"] == "DRAFT"

    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            "SELECT status, issued_at FROM electronic_invoices WHERE sales_order_id = ?",
            (order["id"],),
        ).fetchall()
        assert rows == [("DRAFT", None)]


def test_order_without_customer_cannot_be_requested(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        ids = seed_sale_data(db_path)
        order = _create_paid_order(client, ids)
        assert client.post(f"/api/einvoice/orders/{order['id']}/request").status_code == 422
        preview = client.get(f"/api/einvoice/orders/{order['id']}/preview").json()
        assert preview["customer"]["id"] is None
        assert preview["can_publish"] is False


def test_pos_invoice_draft_appears_in_web_and_no_duplicate(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        ids = seed_sale_data(db_path)
        customer = client.post("/api/pos/customers", json={"name": "Khách lẻ"}).json()
        order = _create_paid_order(
            client, ids, customer_id=customer["id"], request_einvoice=True
        )
        result = client.get("/api/einvoice/orders").json()
        assert result[0]["sales_order_id"] == order["id"]
        assert result[0]["invoice_status"] == "DRAFT"
        assert client.post(f"/api/einvoice/orders/{order['id']}/request").status_code == 409
