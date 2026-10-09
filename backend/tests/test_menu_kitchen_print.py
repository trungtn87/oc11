"""Regression: menu printing flags shared by Web/POS and kitchen/check slips."""
import json
import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.tests.test_pos import seed_menu


def add_drink(db_path):
    with sqlite3.connect(db_path) as connection:
        group_id, unit_id = connection.execute(
            "SELECT menu_group_id, sale_unit_id FROM menu_items LIMIT 1"
        ).fetchone()
        # Drink has its own stock ingredient so normal stock deductions still run.
        item_group_id = connection.execute(
            "SELECT id FROM item_groups LIMIT 1"
        ).fetchone()[0]
        source = connection.execute(
            "INSERT INTO items (name, item_group_id, default_unit_id, smallest_unit_id, is_active) "
            "VALUES ('Nước suối tồn', ?, ?, ?, 1)",
            (item_group_id, unit_id, unit_id),
        )
        inventory_id = source.lastrowid
        connection.execute(
            "INSERT INTO item_unit_conversions "
            "(item_id, unit_id, quantity_in_smallest_unit, is_active) "
            "VALUES (?, ?, 1, 1)", (inventory_id, unit_id),
        )
        connection.execute(
            "INSERT INTO inventory_movements "
            "(item_id, movement_time, quantity_delta, source_type, source_id, source_line_id) "
            "VALUES (?, '2026-10-07T10:00:00', 50, 'STOCK_ADJUSTMENT', 'seed', 'water')",
            (inventory_id,),
        )
        cursor = connection.execute(
            "INSERT INTO menu_items (name, menu_group_id, sale_unit_id, base_price, is_active) "
            "VALUES ('Nước suối', ?, ?, 10000, 1)",
            (group_id, unit_id),
        )
        drink_id = cursor.lastrowid
        connection.execute(
            "INSERT INTO menu_item_ingredients (menu_item_id, item_id, unit_id, quantity) "
            "VALUES (?, ?, ?, 1)", (drink_id, inventory_id, unit_id),
        )
        connection.commit()
        return drink_id


def setup_client(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "data"))
    return db_path


def test_menu_kitchen_print_batch_is_atomic_and_defaults_on(tmp_path, monkeypatch):
    db_path = setup_client(tmp_path, monkeypatch)
    with TestClient(app) as client:
        seafood = seed_menu(db_path)
        drink = add_drink(db_path)
        response = client.get("/api/menu/kitchen-print-items")
        assert response.status_code == 200
        assert {item["id"]: item["print_to_kitchen"] for item in response.json()} == {
            seafood: True, drink: True,
        }
        saved = client.put("/api/menu/kitchen-print-items", json={"items": [
            {"menu_item_id": drink, "print_to_kitchen": False},
        ]})
        assert saved.status_code == 200, saved.text
        assert {item["id"]: item["print_to_kitchen"] for item in saved.json()} == {
            seafood: True, drink: False,
        }
        bad = client.put("/api/menu/kitchen-print-items", json={"items": [
            {"menu_item_id": seafood, "print_to_kitchen": False},
            {"menu_item_id": 999999, "print_to_kitchen": True},
        ]})
        assert bad.status_code == 404
        assert client.get("/api/menu/kitchen-print-items").json() == saved.json()
        duplicates = client.put("/api/menu/kitchen-print-items", json={"items": [
            {"menu_item_id": drink, "print_to_kitchen": True},
            {"menu_item_id": drink, "print_to_kitchen": False},
        ]})
        assert duplicates.status_code == 422
        with sqlite3.connect(db_path) as connection:
            assert connection.execute(
                "SELECT print_to_kitchen FROM menu_items WHERE id = ?", (drink,)
            ).fetchone()[0] == 0
            assert connection.execute(
                "SELECT print_to_kitchen FROM menu_items WHERE id = ?", (seafood,)
            ).fetchone()[0] == 1


def test_order_mixed_and_drinks_only_print_correct_destinations(tmp_path, monkeypatch):
    db_path = setup_client(tmp_path, monkeypatch)
    called = []
    monkeypatch.setattr("backend.app.pos.print_text",
                        lambda printer, receipt: (called.append((printer, receipt)) or True, None))
    with TestClient(app) as client:
        seafood = seed_menu(db_path)
        drink = add_drink(db_path)
        client.put("/api/pos/settings", json={
            "kitchen_printer_name": "Bep", "cashier_printer_name": "Thu ngan"
        })
        client.put("/api/menu/kitchen-print-items", json={"items": [
            {"menu_item_id": drink, "print_to_kitchen": False},
        ]})
        payload = {"order_type": "TAKEAWAY", "items": [
            {"menu_item_id": seafood, "quantity": 1},
            {"menu_item_id": drink, "quantity": 2},
        ]}
        created = client.post("/api/sales/orders", json=payload)
        assert created.status_code == 201, created.text
        order_id = created.json()["id"]
        assert [item["print_to_kitchen"] for item in created.json()["items"]] == [True, False]

        sent = client.post(f"/api/pos/orders/{order_id}/send-kitchen")
        assert sent.status_code == 200, sent.text
        assert sent.json()["print_status"] == "PRINTED"
        assert [name for name, _ in called] == ["Bep", "Thu ngan"]
        assert "Ốc luộc" in called[0][1]
        assert "Nước suối" not in called[0][1]
        assert "Ốc luộc" in called[1][1] and "Nước suối" in called[1][1]
        assert client.post(f"/api/pos/orders/{order_id}/send-kitchen").json()[
            "print_status"] == "NO_NEW_ITEMS"
        assert len(called) == 2

        # Raising a drink quantity only sends the added units to the checker.
        updated = client.put(f"/api/sales/orders/{order_id}", json={
            **payload, "items": [
                {"menu_item_id": seafood, "quantity": 1},
                {"menu_item_id": drink, "quantity": 3},
            ],
        })
        assert updated.status_code == 200, updated.text
        assert [item["print_to_kitchen"] for item in updated.json()["items"]] == [True, False]
        next_send = client.post(f"/api/pos/orders/{order_id}/send-kitchen")
        assert next_send.json()["print_status"] == "PRINTED"
        assert [name for name, _ in called] == ["Bep", "Thu ngan", "Thu ngan"]
        assert "Nước suối" in called[2][1] and "Ốc luộc" not in called[2][1]
        with sqlite3.connect(db_path) as connection:
            tickets = connection.execute(
                "SELECT payload_json, kitchen_print_ok, check_print_ok FROM kitchen_tickets "
                "WHERE sales_order_id = ? ORDER BY id", (order_id,)
            ).fetchall()
        assert len(tickets) == 2
        assert [ticket[1:] for ticket in tickets] == [(1, 1), (1, 1)]
        assert json.loads(tickets[0][0])["items"][1]["print_to_kitchen"] is False

        # Order with only water never requires/prints a kitchen device.
        created_drink = client.post("/api/sales/orders", json={
            "order_type": "TAKEAWAY",
            "items": [{"menu_item_id": drink, "quantity": 1}],
        })
        assert created_drink.status_code == 201, created_drink.text
        drink_id = created_drink.json()["id"]
        no_kitchen = client.post(f"/api/pos/orders/{drink_id}/send-kitchen")
        assert no_kitchen.json()["print_status"] == "PRINTED"
        assert [name for name, _ in called] == ["Bep", "Thu ngan", "Thu ngan", "Thu ngan"]
        assert client.post(f"/api/pos/orders/{drink_id}/send-kitchen").json()[
            "print_status"] == "NO_NEW_ITEMS"
        assert client.get(f"/api/sales/orders/{drink_id}").json()["kitchen_sent_at"] is None


def test_captured_print_choice_survives_menu_change_and_order_edit(tmp_path, monkeypatch):
    db_path = setup_client(tmp_path, monkeypatch)
    called = []
    monkeypatch.setattr("backend.app.pos.print_text",
                        lambda name, text: (called.append((name, text)) or True, None))
    with TestClient(app) as client:
        seafood = seed_menu(db_path)
        drink = add_drink(db_path)
        client.put("/api/pos/settings", json={
            "kitchen_printer_name": "Bep", "cashier_printer_name": "Thu ngan"
        })
        client.put("/api/menu/kitchen-print-items", json={"items": [
            {"menu_item_id": drink, "print_to_kitchen": False}
        ]})
        payload = {"order_type": "TAKEAWAY", "items": [
            {"menu_item_id": seafood, "quantity": 1},
            {"menu_item_id": drink, "quantity": 1},
        ]}
        order = client.post("/api/sales/orders", json=payload).json()
        client.put("/api/menu/kitchen-print-items", json={"items": [
            {"menu_item_id": seafood, "print_to_kitchen": False},
            {"menu_item_id": drink, "print_to_kitchen": True}
        ]})
        edited = client.put(f"/api/sales/orders/{order['id']}", json=payload)
        assert edited.status_code == 200, edited.text
        assert [item["print_to_kitchen"] for item in edited.json()["items"]] == [True, False]
        dispatched = client.post(f"/api/pos/orders/{order['id']}/send-kitchen")
        assert dispatched.json()["print_status"] == "PRINTED"
        assert "Ốc luộc" in called[0][1] and "Nước suối" not in called[0][1]
        assert "Nước suối" in called[1][1]


def test_check_only_print_retry_does_not_reprint_or_request_kitchen(tmp_path, monkeypatch):
    db_path = setup_client(tmp_path, monkeypatch)
    called = []
    failure = {"on": True}

    def printer(name, text):
        called.append((name, text))
        return (False, "Hết giấy") if failure["on"] else (True, None)

    monkeypatch.setattr("backend.app.pos.print_text", printer)
    with TestClient(app) as client:
        seafood = seed_menu(db_path)
        client.put("/api/pos/settings", json={
            "kitchen_printer_name": "", "cashier_printer_name": "Thu ngan"
        })
        client.put("/api/menu/kitchen-print-items", json={"items": [
            {"menu_item_id": seafood, "print_to_kitchen": False}
        ]})
        order_id = client.post("/api/sales/orders", json={
            "order_type": "TAKEAWAY",
            "items": [{"menu_item_id": seafood, "quantity": 1}],
        }).json()["id"]
        uri = f"/api/pos/orders/{order_id}/send-kitchen"
        first = client.post(uri)
        assert first.json()["print_status"] == "FAILED"
        assert [p for p, _ in called] == ["Thu ngan"]
        failure["on"] = False
        retried = client.post(uri)
        assert retried.json()["print_status"] == "PRINTED"
        assert [p for p, _ in called] == ["Thu ngan", "Thu ngan"]
        assert client.post(uri).json()["print_status"] == "NO_NEW_ITEMS"
