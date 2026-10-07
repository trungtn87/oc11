import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import app


def seed_menu(db_path):
    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("INSERT INTO units (name, is_active) VALUES ('đĩa', 1)")
        unit_id = connection.execute("SELECT id FROM units WHERE name = 'đĩa'").fetchone()[0]
        connection.execute("INSERT INTO item_groups (name, is_active) VALUES ('Hải sản', 1)")
        group_id = connection.execute("SELECT id FROM item_groups WHERE name = 'Hải sản'").fetchone()[0]
        connection.execute(
            """INSERT INTO items (name, item_group_id, default_unit_id, smallest_unit_id, is_active)
               VALUES ('Ốc test', ?, ?, ?, 1)""",
            (group_id, unit_id, unit_id),
        )
        item_id = connection.execute("SELECT id FROM items WHERE name = 'Ốc test'").fetchone()[0]
        connection.execute(
            """INSERT INTO item_unit_conversions (item_id, unit_id, quantity_in_smallest_unit, is_active)
               VALUES (?, ?, 1, 1)""",
            (item_id, unit_id),
        )
        connection.execute("INSERT INTO menu_groups (name, display_order, is_active) VALUES ('Ốc', 0, 1)")
        menu_group_id = connection.execute("SELECT id FROM menu_groups WHERE name = 'Ốc'").fetchone()[0]
        connection.execute(
            """INSERT INTO menu_items (name, menu_group_id, sale_unit_id, base_price, is_active)
               VALUES ('Ốc luộc', ?, ?, 80000, 1)""",
            (menu_group_id, unit_id),
        )
        menu_item_id = connection.execute("SELECT id FROM menu_items WHERE name = 'Ốc luộc'").fetchone()[0]
        connection.execute(
            """INSERT INTO menu_item_ingredients (menu_item_id, item_id, unit_id, quantity)
               VALUES (?, ?, ?, 1)""",
            (menu_item_id, item_id, unit_id),
        )
        connection.execute(
            """INSERT INTO inventory_movements (
                 item_id, movement_time, quantity_delta, source_type, source_id, source_line_id, note
               ) VALUES (?, '2026-10-07T10:00:00', 20, 'STOCK_ADJUSTMENT', 'seed', 'seed', 'Tồn test')""",
            (item_id,),
        )
        connection.execute(
            """INSERT INTO fund_accounts (name, type, current_balance, is_active, is_default)
               VALUES ('Quỹ quán', 'CASH', 0, 1, 1)"""
        )
        connection.commit()
    return menu_item_id


def test_tables_are_managed_and_open_order_occupies_table(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        menu_item_id = seed_menu(db_path)
        area = client.post("/api/pos/areas", json={"name": "Tầng 1", "display_order": 1, "is_active": True})
        assert area.status_code == 201
        table = client.post(
            "/api/pos/tables",
            json={
                "area_id": area.json()["id"], "name": "1", "seats": 4,
                "display_order": 1, "pos_x": 10, "pos_y": 20, "is_active": True,
            },
        )
        assert table.status_code == 201
        table_id = table.json()["id"]

        created = client.post(
            "/api/sales/orders",
            json={
                "order_type": "DINE_IN", "table_id": table_id, "guest_count": 3,
                "items": [{"menu_item_id": menu_item_id, "quantity": 1}],
            },
        )
        assert created.status_code == 201
        order = created.json()
        assert order["table_id"] == table_id
        assert order["table_name"] == "1"
        assert order["area_name"] == "Tầng 1"
        assert order["guest_count"] == 3

        tables = client.get("/api/pos/tables?active_only=true").json()
        assert tables[0]["open_order_id"] == order["id"]
        assert tables[0]["open_order_total"] == 80000

        duplicate = client.post(
            "/api/sales/orders",
            json={
                "order_type": "DINE_IN", "table_id": table_id,
                "items": [{"menu_item_id": menu_item_id, "quantity": 1}],
            },
        )
        assert duplicate.status_code == 409

        funds = client.get("/api/fund-accounts?type=CASH").json()
        paid = client.post(
            f"/api/sales/orders/{order['id']}/pay",
            json={"fund_account_id": funds[0]["id"]},
        )
        assert paid.status_code == 200
        after = client.get("/api/pos/tables?active_only=true").json()
        assert after[0]["open_order_id"] is None


def test_kitchen_send_is_logged_when_printer_is_not_configured(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "data"))

    with TestClient(app) as client:
        menu_item_id = seed_menu(db_path)
        created = client.post(
            "/api/sales/orders",
            json={
                "order_type": "TAKEAWAY",
                "items": [{"menu_item_id": menu_item_id, "quantity": 2, "note": "Ít cay"}],
            },
        )
        assert created.status_code == 201
        order_id = created.json()["id"]

        sent = client.post(f"/api/pos/orders/{order_id}/send-kitchen")
        assert sent.status_code == 200
        payload = sent.json()
        assert payload["print_status"] == "FAILED"
        assert "cấu hình" in payload["error_message"].lower()

        refreshed = client.get(f"/api/sales/orders/{order_id}").json()
        assert refreshed["kitchen_sent_at"] is None

    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            "SELECT print_status, payload_json FROM kitchen_tickets WHERE sales_order_id = ?",
            (order_id,),
        ).fetchone()
        assert row is not None
        assert row[0] == "FAILED"
        assert "Ốc luộc" in row[1]
