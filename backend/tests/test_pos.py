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



def test_bulk_table_creation_generates_names_and_layout(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        area = client.post(
            "/api/pos/areas",
            json={"name": "Sân", "display_order": 0, "is_active": True},
        )
        assert area.status_code == 201
        area_id = area.json()["id"]

        first = client.post(
            "/api/pos/tables",
            json={
                "area_id": area_id,
                "name": "Bàn 1",
                "seats": 0,
                "display_order": 0,
                "pos_x": 4,
                "pos_y": 6,
                "is_active": True,
            },
        )
        assert first.status_code == 201

        created = client.post(
            "/api/pos/tables/bulk",
            json={"area_id": area_id, "quantity": 3},
        )
        assert created.status_code == 201
        rows = created.json()
        assert [row["name"] for row in rows] == ["Bàn 2", "Bàn 3", "Bàn 4"]
        assert all(row["seats"] == 0 for row in rows)
        assert len({(row["pos_x"], row["pos_y"]) for row in rows}) == 3

        moved = client.put(
            f"/api/pos/tables/{rows[0]['id']}",
            json={
                "area_id": area_id,
                "name": "Bàn VIP",
                "seats": 0,
                "display_order": rows[0]["display_order"],
                "pos_x": 41.5,
                "pos_y": 52.25,
                "is_active": True,
            },
        )
        assert moved.status_code == 200
        assert moved.json()["name"] == "Bàn VIP"
        assert moved.json()["pos_x"] == 41.5
        assert moved.json()["pos_y"] == 52.25


def test_order_from_table_can_be_reopened_and_edited_without_payment(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        menu_item_id = seed_menu(db_path)
        area = client.post(
            "/api/pos/areas",
            json={"name": "Tầng 1", "display_order": 0, "is_active": True},
        )
        assert area.status_code == 201
        table = client.post(
            "/api/pos/tables",
            json={
                "area_id": area.json()["id"],
                "name": "Bàn 11",
                "seats": 0,
                "display_order": 0,
                "pos_x": 20.0,
                "pos_y": 30.0,
                "is_active": True,
            },
        )
        assert table.status_code == 201
        table_id = table.json()["id"]

        first = client.post(
            "/api/sales/orders",
            json={
                "order_type": "DINE_IN",
                "table_id": table_id,
                "items": [
                    {"menu_item_id": menu_item_id, "quantity": 1, "note": "Ít cay"}
                ],
            },
        )
        assert first.status_code == 201, first.text
        order_id = first.json()["id"]
        assert first.json()["status"] == "OPEN"
        assert first.json()["total_amount"] == 80000

        area_tables = client.get("/api/pos/tables?active_only=true")
        assert area_tables.status_code == 200
        assert area_tables.json()[0]["open_order_id"] == order_id
        assert area_tables.json()[0]["open_order_total"] == 80000

        reopened = client.get(f"/api/sales/orders/{order_id}")
        assert reopened.status_code == 200
        assert reopened.json()["items"][0]["note"] == "Ít cay"

        changed = client.put(
            f"/api/sales/orders/{order_id}",
            json={
                "order_type": "DINE_IN",
                "table_id": table_id,
                "payment_status": "DEBT",
                "items": [
                    {"menu_item_id": menu_item_id, "quantity": 2, "note": "Ít cay"}
                ],
            },
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["id"] == order_id
        assert changed.json()["status"] == "OPEN"
        assert changed.json()["table_id"] == table_id
        assert changed.json()["total_amount"] == 160000
        assert changed.json()["paid_at"] is None
        assert changed.json()["payment_reference_code"] is None

        active = client.get("/api/sales/orders?status=OPEN")
        assert active.status_code == 200
        assert len(
            [row for row in active.json() if row["table_id"] == table_id]
        ) == 1

        refreshed_tables = client.get("/api/pos/tables?active_only=true")
        assert refreshed_tables.json()[0]["open_order_total"] == 160000

    with sqlite3.connect(db_path) as connection:
        payments = connection.execute(
            "SELECT COUNT(*) FROM fund_transactions WHERE source_type = 'SALE'"
        ).fetchone()[0]
        assert payments == 0



def test_printer_settings_route_and_temporary_kitchen_note_do_not_persist(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "pos-settings"))
    captured: list[tuple[str, str]] = []

    def fake_print(name: str, content: str):
        captured.append((name, content))
        return True, None

    monkeypatch.setattr("backend.app.pos.print_text", fake_print)
    with TestClient(app) as client:
        item_id = seed_menu(db_path)
        configured = client.put(
            "/api/pos/settings",
            json={
                "kitchen_printer_name": "May Bep",
                "cashier_printer_name": "May Thu Ngan",
                "send_kitchen_targets": "BOTH",
                "print_receipt_targets": "CASHIER",
            },
        )
        assert configured.status_code == 200, configured.text
        assert client.get("/api/pos/settings").json()["send_kitchen_targets"] == "BOTH"
        assert client.put(
            "/api/pos/settings",
            json={"send_kitchen_targets": "INVALID"},
        ).status_code == 422

        created = client.post("/api/sales/orders", json={
            "order_type": "TAKEAWAY",
            "items": [{"menu_item_id": item_id, "quantity": 1}],
        })
        assert created.status_code == 201, created.text
        order_id = created.json()["id"]
        temp_note = "Bàn gấp - ra món cùng lúc"
        sent = client.post(
            f"/api/pos/orders/{order_id}/send-kitchen",
            json={"temporary_note": temp_note},
        )
        assert sent.status_code == 200, sent.text
        assert sent.json()["print_status"] == "PRINTED"
        assert [row["role"] for row in sent.json()["printer_results"]] == [
            "KITCHEN", "CASHIER"
        ]
        assert [row[0] for row in captured] == ["May Bep", "May Thu Ngan"]
        assert all(temp_note in content for _, content in captured)
        assert client.get(f"/api/sales/orders/{order_id}").json()["note"] is None

    with sqlite3.connect(db_path) as connection:
        saved = connection.execute(
            "SELECT payload_json, print_status FROM kitchen_tickets WHERE sales_order_id = ?",
            (order_id,),
        ).fetchone()
        assert saved[1] == "PRINTED"
        assert temp_note not in saved[0]
        row = connection.execute(
            "SELECT note, kitchen_sent_at FROM sales_orders WHERE id = ?", (order_id,)
        ).fetchone()
        assert row[0] is None
        assert row[1] is not None


def test_partial_printer_failure_can_retry_without_persisting_note(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "printer-failure"))
    captured: list[str] = []

    def failing_cashier(name: str, content: str):
        captured.append(name)
        return (False, "Máy in thu ngân mất kết nối") if name == "Cashier" else (True, None)

    monkeypatch.setattr("backend.app.pos.print_text", failing_cashier)
    with TestClient(app) as client:
        item_id = seed_menu(db_path)
        configured = client.put("/api/pos/settings", json={
            "kitchen_printer_name": "Kitchen",
            "cashier_printer_name": "Cashier",
            "send_kitchen_targets": "BOTH",
            "print_receipt_targets": "BOTH",
        })
        assert configured.status_code == 200
        order = client.post("/api/sales/orders", json={
            "order_type": "TAKEAWAY",
            "items": [{"menu_item_id": item_id, "quantity": 1}],
        }).json()
        sent = client.post(
            f"/api/pos/orders/{order['id']}/send-kitchen",
            json={"temporary_note": "Chỉ in tạm"},
        )
        assert sent.status_code == 200
        assert sent.json()["print_status"] == "FAILED"
        assert len(sent.json()["printer_results"]) == 2
        assert [r["ok"] for r in sent.json()["printer_results"]] == [True, False]
        assert "Thu ngân" in sent.json()["error_message"]
        assert client.get(f"/api/sales/orders/{order['id']}").json()["kitchen_sent_at"] is not None

        # Retry only the failed cashier; kitchen has already received its slip.
        monkeypatch.setattr("backend.app.pos.print_text", lambda name, content: (True, None))
        retry = client.post(
            f"/api/pos/orders/{order['id']}/send-kitchen",
            json={"temporary_note": "Chỉ in tạm"},
        )
        assert retry.json()["print_status"] == "PRINTED"
        assert retry.json()["ticket_id"] == sent.json()["ticket_id"]
        assert captured == ["Kitchen", "Cashier"]

    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            "SELECT payload_json FROM kitchen_tickets WHERE sales_order_id = ?",
            (order["id"],),
        ).fetchall()
        assert len(rows) == 1
        assert all("Chỉ in tạm" not in row[0] for row in rows)


def test_cashier_receipt_print_routing_is_separate_from_payment(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "receipt-settings"))
    captured: list[tuple[str, str]] = []

    def fake_print(name: str, content: str):
        captured.append((name, content))
        return (False, "Hết giấy") if name == "Cashier" else (True, None)

    monkeypatch.setattr("backend.app.pos.print_text", fake_print)
    with TestClient(app) as client:
        item_id = seed_menu(db_path)
        assert client.put("/api/pos/settings", json={
            "kitchen_printer_name": "Kitchen",
            "cashier_printer_name": "Cashier",
            "send_kitchen_targets": "KITCHEN",
            "print_receipt_targets": "BOTH",
        }).status_code == 200
        order = client.post("/api/sales/orders", json={
            "order_type": "TAKEAWAY",
            "items": [{"menu_item_id": item_id, "quantity": 1}],
        }).json()
        no_payment = client.post(f"/api/pos/orders/{order['id']}/print-receipt")
        assert no_payment.status_code == 409
        funds = client.get("/api/fund-accounts?type=CASH").json()
        paid = client.post(
            f"/api/sales/orders/{order['id']}/pay",
            json={"fund_account_id": funds[0]["id"]},
        )
        assert paid.status_code == 200
        printed = client.post(f"/api/pos/orders/{order['id']}/print-receipt")
        assert printed.status_code == 200
        assert printed.json()["print_status"] == "FAILED"
        assert [name for name, _ in captured] == ["Kitchen", "Cashier"]
        assert all("PHIẾU THANH TOÁN" in text for _, text in captured)
        assert all("80,000" in text for _, text in captured)
        # Print failure cannot charge the customer a second time.
        after = client.get(f"/api/sales/orders/{order['id']}").json()
        assert after["status"] == "PAID"
        assert after["total_amount"] == 80000
        assert client.post(f"/api/sales/orders/{order['id']}/pay",
                           json={"fund_account_id": funds[0]["id"]}).status_code == 409


def test_same_physical_printer_is_printed_once_even_when_route_is_both(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "same-printer"))
    captured: list[str] = []
    monkeypatch.setattr(
        "backend.app.pos.print_text",
        lambda name, content: (captured.append(name) or True, None),
    )
    with TestClient(app) as client:
        item_id = seed_menu(db_path)
        assert client.put("/api/pos/settings", json={
            "kitchen_printer_name": "Shared Printer",
            "cashier_printer_name": "Shared Printer",
            "send_kitchen_targets": "BOTH",
            "print_receipt_targets": "BOTH",
        }).status_code == 200
        order = client.post("/api/sales/orders", json={
            "order_type": "TAKEAWAY",
            "items": [{"menu_item_id": item_id, "quantity": 1}],
        }).json()
        sent = client.post(f"/api/pos/orders/{order['id']}/send-kitchen")
        assert sent.json()["print_status"] == "PRINTED"
        # Two DIFFERENT tickets still print on the same physical device.
        assert captured == ["Shared Printer", "Shared Printer"]
        assert len(sent.json()["printer_results"]) == 2


def test_pos_debt_checkout_releases_table_and_collects_once(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        item_id = seed_menu(db_path)
        area = client.post("/api/pos/areas", json={"name": "Sân"}).json()
        table = client.post("/api/pos/tables", json={
            "area_id": area["id"], "name": "Bàn 11",
            "is_active": True, "seats": 0,
        }).json()
        order = client.post("/api/sales/orders", json={
            "order_type": "DINE_IN", "table_id": table["id"],
            "items": [{"menu_item_id": item_id, "quantity": 1}],
        }).json()
        customer = client.post("/api/pos/customers", json={
            "name": "Anh khách", "phone": "0911000000",
        })
        assert customer.status_code == 201
        customer_id = customer.json()["id"]
        assert client.get("/api/pos/customers?q=0911").json()[0]["id"] == customer_id
        no_customer = client.post(f"/api/sales/orders/{order['id']}/pay", json={
            "payment_method": "DEBT",
        })
        assert no_customer.status_code == 422
        debt = client.post(f"/api/sales/orders/{order['id']}/pay", json={
            "payment_method": "DEBT", "customer_id": customer_id,
        })
        assert debt.status_code == 200, debt.text
        assert debt.json()["status"] == "PAID"
        assert debt.json()["settlement_status"] == "DEBT"
        assert debt.json()["fund_account_id"] is None
        assert debt.json()["paid_at"] is None
        assert client.get("/api/pos/tables").json()[0]["open_order_id"] is None
        with sqlite3.connect(db_path) as connection:
            assert connection.execute(
                "SELECT COUNT(*) FROM fund_transactions WHERE source_type='SALE'"
            ).fetchone()[0] == 0
        duplicate = client.post(f"/api/sales/orders/{order['id']}/pay", json={
            "payment_method": "DEBT", "customer_id": customer_id,
        })
        assert duplicate.status_code == 409
        funds = client.get("/api/fund-accounts?type=CASH").json()
        settled = client.post(f"/api/sales/orders/{order['id']}/pay", json={
            "payment_method": "CASH", "fund_account_id": funds[0]["id"],
        })
        assert settled.status_code == 200, settled.text
        assert settled.json()["settlement_status"] == "PAID"
        again = client.post(f"/api/sales/orders/{order['id']}/pay", json={
            "payment_method": "CASH", "fund_account_id": funds[0]["id"],
        })
        assert again.status_code == 409
        with sqlite3.connect(db_path) as connection:
            assert connection.execute(
                "SELECT COUNT(*) FROM fund_transactions WHERE source_type='SALE' AND is_void=0"
            ).fetchone()[0] == 1


def test_pos_invoice_request_is_draft_after_cash_payment(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        item_id = seed_menu(db_path)
        order = client.post("/api/sales/orders", json={
            "items": [{"menu_item_id": item_id, "quantity": 1}],
        }).json()
        account = client.get("/api/fund-accounts?type=CASH").json()[0]
        missing = client.post(f"/api/sales/orders/{order['id']}/pay", json={
            "payment_method": "CASH", "fund_account_id": account["id"],
            "request_einvoice": True,
        })
        assert missing.status_code == 422
        missing_address = client.post("/api/pos/customers", json={
            "name": "Công ty ABC", "customer_type": "ORGANIZATION",
            "tax_code": "0123456789",
        })
        assert missing_address.status_code == 422
        customer = client.post("/api/pos/customers", json={
            "name": "Công ty ABC", "customer_type": "ORGANIZATION",
            "tax_code": "0123456789", "address": "Cao Bằng",
            "email": "a@example.com",
        }).json()
        paid = client.post(f"/api/sales/orders/{order['id']}/pay", json={
            "payment_method": "CASH", "fund_account_id": account["id"],
            "customer_id": customer["id"], "request_einvoice": True,
        })
        assert paid.status_code == 200, paid.text
        assert paid.json()["einvoice_requested"] is True
        assert paid.json()["has_einvoice"] is False
        assert paid.json()["customer_id"] == customer["id"]
        with sqlite3.connect(db_path) as connection:
            assert connection.execute(
                "SELECT status, issued_at FROM electronic_invoices WHERE sales_order_id = ?",
                (order["id"],),
            ).fetchone() == ("DRAFT", None)


def test_pos_estimate_and_kitchen_cancel_are_not_payments(tmp_path, monkeypatch):
    from backend.app import pos

    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    printed = []
    def fake_dispatch(settings, target, content):
        printed.append((target, content))
        return "PRINTED", None, []
    monkeypatch.setattr(pos, "dispatch_print", fake_dispatch)

    with TestClient(app) as client:
        item_id = seed_menu(db_path)
        area = client.post("/api/pos/areas", json={"name": "Tầng 1"}).json()
        table = client.post("/api/pos/tables", json={
            "area_id": area["id"], "name": "Bàn 7",
            "is_active": True,
        }).json()
        order = client.post("/api/sales/orders", json={
            "order_type": "DINE_IN", "table_id": table["id"],
            "items": [{"menu_item_id": item_id, "quantity": 1}],
        }).json()
        slip = client.post(f"/api/pos/orders/{order['id']}/print-estimate")
        assert slip.status_code == 200, slip.text
        assert printed[0][0] == "CASHIER"
        assert "TẠM TÍNH" in printed[0][1]
        assert "THỰC THU" not in printed[0][1]
        assert client.get(f"/api/sales/orders/{order['id']}").json()["status"] == "OPEN"
        with sqlite3.connect(db_path) as connection:
            connection.execute(
                "UPDATE sales_orders SET kitchen_sent_at = ? WHERE id = ?",
                ("2026-10-08T18:00:00", order["id"]),
            )
            connection.commit()
        canceled = client.post(
            f"/api/sales/orders/{order['id']}/void?reason=Kh%C3%A1ch%20h%E1%BB%A7y"
        )
        assert canceled.status_code == 200, canceled.text
        assert canceled.json()["status"] == "VOID"
        slip_cancel = client.post(f"/api/pos/orders/{order['id']}/print-cancel")
        assert slip_cancel.status_code == 200, slip_cancel.text
        assert printed[-1][0] == "KITCHEN"
        assert "HỦY TOÀN BỘ ORDER" in printed[-1][1]
        assert client.get("/api/pos/tables").json()[0]["open_order_id"] is None
        with sqlite3.connect(db_path) as connection:
            assert connection.execute(
                "SELECT COUNT(*) FROM fund_transactions WHERE source_type='SALE'"
            ).fetchone()[0] == 0
