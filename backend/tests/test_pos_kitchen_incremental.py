"""Regression coverage for incremental 80 mm kitchen/check slips."""
import json
import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.tests.test_pos import seed_menu


def test_only_added_quantity_is_sent_and_receives_checklist(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "settings"))
    printed = []
    monkeypatch.setattr(
        "backend.app.pos.print_text",
        lambda name, text: (printed.append((name, text)) or True, None),
    )
    with TestClient(app) as client:
        item_id = seed_menu(tmp_path / "oc11.db")
        config = client.put("/api/pos/settings", json={
            "kitchen_printer_name": "Bep",
            "cashier_printer_name": "Thu ngan",
            "send_kitchen_targets": "KITCHEN",  # legacy setting must not suppress checking
            "print_receipt_targets": "CASHIER",
        })
        assert config.status_code == 200, config.text
        assert config.json()["send_kitchen_targets"] == "BOTH"
        create_payload = {
            "order_type": "TAKEAWAY",
            "items": [{"menu_item_id": item_id, "quantity": 1, "note": "It cay"}],
        }
        created = client.post("/api/sales/orders", json=create_payload)
        assert created.status_code == 201, created.text
        order_id = created.json()["id"]
        first = client.post(
            f"/api/pos/orders/{order_id}/send-kitchen",
            json={"temporary_note": "Ra cung luc"},
        )
        assert first.status_code == 200, first.text
        assert first.json()["print_status"] == "PRINTED"
        assert len(printed) == 2
        assert printed[0][0] == "Bep" and "CHẾ BIẾN" in printed[0][1]
        assert printed[1][0] == "Thu ngan" and "[ ]" in printed[1][1]
        assert "Ra cung luc" in printed[0][1]
        assert "Ra cung luc" in printed[1][1]

        nothing = client.post(f"/api/pos/orders/{order_id}/send-kitchen")
        assert nothing.status_code == 200
        assert nothing.json()["print_status"] == "NO_NEW_ITEMS"
        assert len(printed) == 2

        # Editing a note does not represent an added serving.
        note_only = client.put(f"/api/sales/orders/{order_id}", json={
            **create_payload,
            "payment_status": "DEBT",
            "items": [{"menu_item_id": item_id, "quantity": 1, "note": "Khong hanh"}],
        })
        assert note_only.status_code == 200, note_only.text
        assert client.post(f"/api/pos/orders/{order_id}/send-kitchen").json()[
            "print_status"
        ] == "NO_NEW_ITEMS"
        assert len(printed) == 2

        changed = client.put(f"/api/sales/orders/{order_id}", json={
            **create_payload,
            "payment_status": "DEBT",
            "items": [{"menu_item_id": item_id, "quantity": 3, "note": "It cay"}],
        })
        assert changed.status_code == 200, changed.text
        second = client.post(f"/api/pos/orders/{order_id}/send-kitchen")
        assert second.status_code == 200, second.text
        assert second.json()["print_status"] == "PRINTED"
        assert len(printed) == 4
        assert "It cay" in printed[2][1]

    with sqlite3.connect(tmp_path / "oc11.db") as db:
        tickets = db.execute(
            "SELECT payload_json, kitchen_print_ok, check_print_ok "
            "FROM kitchen_tickets WHERE sales_order_id = ? ORDER BY id",
            (order_id,),
        ).fetchall()
        assert len(tickets) == 2
        assert [json.loads(t[0])["items"][0]["quantity"] for t in tickets] == [1, 2]
        assert all(t[1:] == (1, 1) for t in tickets)
        assert all("Ra cung luc" not in t[0] for t in tickets)


def test_failed_destination_only_is_retried_no_duplicate_kitchen(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "settings"))
    calls = []
    failing = {"cashier": True}

    def fake_print(printer, text):
        calls.append((printer, text))
        if printer == "Cashier" and failing["cashier"]:
            return False, "Het giay"
        return True, None

    monkeypatch.setattr("backend.app.pos.print_text", fake_print)
    with TestClient(app) as client:
        item_id = seed_menu(tmp_path / "oc11.db")
        client.put("/api/pos/settings", json={
            "kitchen_printer_name": "Kitchen",
            "cashier_printer_name": "Cashier",
        })
        order = client.post("/api/sales/orders", json={
            "order_type": "TAKEAWAY",
            "items": [{"menu_item_id": item_id, "quantity": 1}],
        }).json()
        url = f"/api/pos/orders/{order['id']}/send-kitchen"
        first = client.post(url)
        assert first.status_code == 200 and first.json()["print_status"] == "FAILED"
        assert [x[0] for x in calls] == ["Kitchen", "Cashier"]
        failing["cashier"] = False
        retry = client.post(url)
        assert retry.status_code == 200 and retry.json()["print_status"] == "PRINTED"
        assert retry.json()["ticket_id"] == first.json()["ticket_id"]
        assert [x[0] for x in calls] == ["Kitchen", "Cashier", "Cashier"]
        assert client.post(url).json()["print_status"] == "NO_NEW_ITEMS"
        assert len(calls) == 3
