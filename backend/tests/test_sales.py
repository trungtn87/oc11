import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import app


def seed_sale_data(db_path, *, with_ingredient=True):
    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")

        connection.execute("INSERT INTO units (name, is_active) VALUES ('kg', 1)")
        unit_id = connection.execute(
            "SELECT id FROM units WHERE name = 'kg'"
        ).fetchone()[0]

        connection.execute(
            "INSERT INTO item_groups (name, is_active) VALUES ('Hải sản', 1)"
        )
        item_group_id = connection.execute(
            "SELECT id FROM item_groups WHERE name = 'Hải sản'"
        ).fetchone()[0]

        connection.execute(
            """
            INSERT INTO items (
                name,
                item_group_id,
                default_unit_id,
                smallest_unit_id,
                is_active
            )
            VALUES ('Mực', ?, ?, ?, 1)
            """,
            (item_group_id, unit_id, unit_id),
        )
        item_id = connection.execute(
            "SELECT id FROM items WHERE name = 'Mực'"
        ).fetchone()[0]

        connection.execute(
            """
            INSERT INTO item_unit_conversions (
                item_id,
                unit_id,
                quantity_in_smallest_unit,
                is_active
            )
            VALUES (?, ?, 1, 1)
            """,
            (item_id, unit_id),
        )

        connection.execute(
            """
            INSERT INTO menu_groups (name, display_order, is_active)
            VALUES ('Món mực', 0, 1)
            """
        )
        menu_group_id = connection.execute(
            "SELECT id FROM menu_groups WHERE name = 'Món mực'"
        ).fetchone()[0]

        connection.execute(
            """
            INSERT INTO menu_items (
                name,
                menu_group_id,
                sale_unit_id,
                base_price,
                is_active
            )
            VALUES ('Mực hấp', ?, ?, 150000, 1)
            """,
            (menu_group_id, unit_id),
        )
        menu_item_id = connection.execute(
            "SELECT id FROM menu_items WHERE name = 'Mực hấp'"
        ).fetchone()[0]

        if with_ingredient:
            connection.execute(
                """
                INSERT INTO menu_item_ingredients (
                    menu_item_id,
                    item_id,
                    unit_id,
                    quantity
                )
                VALUES (?, ?, ?, 0.5)
                """,
                (menu_item_id, item_id, unit_id),
            )

        connection.execute(
            """
            INSERT INTO fund_accounts (
                name,
                type,
                current_balance,
                is_active,
                is_default
            )
            VALUES ('Quỹ bán hàng', 'CASH', 0, 1, 1)
            """
        )
        fund_account_id = connection.execute(
            "SELECT id FROM fund_accounts WHERE name = 'Quỹ bán hàng'"
        ).fetchone()[0]

        connection.execute(
            """
            INSERT INTO inventory_movements (
                item_id,
                movement_time,
                quantity_delta,
                source_type,
                source_id,
                source_line_id,
                note
            )
            VALUES (?, '2026-10-06T08:00:00', 10, 'STOCK_ADJUSTMENT', 'seed', 'seed', 'Tồn đầu test')
            """,
            (item_id,),
        )
        connection.commit()

    return {
        "item_id": item_id,
        "menu_item_id": menu_item_id,
        "fund_account_id": fund_account_id,
    }


def test_paid_sale_records_money_and_deducts_stock_then_void_restores_all(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        ids = seed_sale_data(db_path)

        created = client.post(
            "/api/sales/orders",
            json={
                "order_time": "2026-10-06T18:00:00",
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 2,
                    }
                ],
            },
        )
        assert created.status_code == 201
        order = created.json()
        assert order["status"] == "OPEN"
        assert order["fund_account_type"] is None
        assert order["fund_account_name"] is None
        assert order["total_amount"] == 300_000
        assert order["stock_deducted"] is True

        stock_before_payment = client.get("/api/inventory/stock").json()
        mực_before_payment = next(
            row for row in stock_before_payment
            if row["item_id"] == ids["item_id"]
        )
        assert mực_before_payment["stock_quantity"] == 9

        funds_before_payment = client.get(
            "/api/fund-accounts?type=CASH"
        ).json()
        fund_before_payment = next(
            row for row in funds_before_payment
            if row["id"] == ids["fund_account_id"]
        )
        assert fund_before_payment["current_balance"] == 0

        paid = client.post(
            f"/api/sales/orders/{order['id']}/pay",
            json={
                "fund_account_id": ids["fund_account_id"],
                "actual_received_amount": 299_000,
            },
        )
        assert paid.status_code == 200
        paid_order = paid.json()
        assert paid_order["status"] == "PAID"
        assert paid_order["fund_account_type"] == "CASH"
        assert paid_order["fund_account_name"] == "Quỹ bán hàng"
        assert paid_order["actual_received_amount"] == 299_000
        assert paid_order["stock_deducted"] is True
        assert paid_order["payment_reference_code"].startswith("PT-")

        stock = client.get("/api/inventory/stock").json()
        mực = next(row for row in stock if row["item_id"] == ids["item_id"])
        assert mực["stock_quantity"] == 9

        funds = client.get("/api/fund-accounts?type=CASH").json()
        fund = next(row for row in funds if row["id"] == ids["fund_account_id"])
        assert fund["current_balance"] == 299_000

        voided = client.post(
            f"/api/sales/orders/{order['id']}/void?reason=Khách đổi đơn"
        )
        assert voided.status_code == 200
        assert voided.json()["status"] == "VOID"

        stock_after_void = client.get("/api/inventory/stock").json()
        mực_after_void = next(
            row for row in stock_after_void if row["item_id"] == ids["item_id"]
        )
        assert mực_after_void["stock_quantity"] == 10

        funds_after_void = client.get("/api/fund-accounts?type=CASH").json()
        fund_after_void = next(
            row for row in funds_after_void
            if row["id"] == ids["fund_account_id"]
        )
        assert fund_after_void["current_balance"] == 0

    with sqlite3.connect(db_path) as connection:
        sale_movements = connection.execute(
            """
            SELECT source_type, quantity_delta
            FROM inventory_movements
            WHERE source_id = ?
              AND source_type IN ('SALE', 'SALE_VOID')
            ORDER BY id
            """,
            (str(order["id"]),),
        ).fetchall()
        assert sale_movements == [
            ("SALE", -1.0),
            ("SALE_VOID", 1.0),
        ]

        payments = connection.execute(
            """
            SELECT amount, is_void
            FROM fund_transactions
            WHERE source_type = 'SALE'
              AND source_id = ?
            """,
            (str(order["id"]),),
        ).fetchall()
        assert payments == [(299_000, 1)]


def test_sale_save_is_rolled_back_when_menu_has_no_stock_recipe(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        ids = seed_sale_data(db_path, with_ingredient=False)

        created = client.post(
            "/api/sales/orders",
            json={
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 1,
                    }
                ]
            },
        )
        assert created.status_code == 409
        assert "nguyên liệu" in created.json()["detail"].lower()

        orders = client.get("/api/sales/orders").json()
        assert orders == []

        funds = client.get("/api/fund-accounts?type=CASH").json()
        fund = next(row for row in funds if row["id"] == ids["fund_account_id"])
        assert fund["current_balance"] == 0

    with sqlite3.connect(db_path) as connection:
        sale_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM inventory_movements
            WHERE source_type = 'SALE'
            """
        ).fetchone()[0]
        payment_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM fund_transactions
            WHERE source_type = 'SALE'
            """
        ).fetchone()[0]
        order_count = connection.execute(
            "SELECT COUNT(*) FROM sales_orders"
        ).fetchone()[0]

        assert sale_count == 0
        assert payment_count == 0
        assert order_count == 0


def test_unpaid_sale_can_be_edited_then_paid_later_and_filtered(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        ids = seed_sale_data(db_path)

        created = client.post(
            "/api/sales/orders",
            json={
                "order_time": "2026-10-06T12:00:00",
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 2,
                    }
                ],
            },
        )
        assert created.status_code == 201
        order = created.json()
        assert order["status"] == "OPEN"
        assert order["stock_deducted"] is True

        open_orders = client.get("/api/sales/orders?status=OPEN")
        assert open_orders.status_code == 200
        assert [row["id"] for row in open_orders.json()] == [order["id"]]

        stock = client.get("/api/inventory/stock").json()
        mực = next(row for row in stock if row["item_id"] == ids["item_id"])
        assert mực["stock_quantity"] == 9

        edited = client.put(
            f"/api/sales/orders/{order['id']}",
            json={
                "order_time": "2026-10-06T12:00:00",
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 1,
                    }
                ],
            },
        )
        assert edited.status_code == 200
        edited_order = edited.json()
        assert edited_order["status"] == "OPEN"
        assert edited_order["total_amount"] == 150_000
        assert edited_order["stock_deducted"] is True

        stock_after_edit = client.get("/api/inventory/stock").json()
        mực_after_edit = next(
            row for row in stock_after_edit
            if row["item_id"] == ids["item_id"]
        )
        assert mực_after_edit["stock_quantity"] == 9.5

        funds_before_payment = client.get(
            "/api/fund-accounts?type=CASH"
        ).json()
        fund_before_payment = next(
            row for row in funds_before_payment
            if row["id"] == ids["fund_account_id"]
        )
        assert fund_before_payment["current_balance"] == 0

        paid = client.post(
            f"/api/sales/orders/{order['id']}/pay",
            json={
                "fund_account_id": ids["fund_account_id"],
                "actual_received_amount": 149_000,
            },
        )
        assert paid.status_code == 200
        paid_order = paid.json()
        assert paid_order["status"] == "PAID"
        assert paid_order["actual_received_amount"] == 149_000

        stock_after_payment = client.get("/api/inventory/stock").json()
        mực_after_payment = next(
            row for row in stock_after_payment
            if row["item_id"] == ids["item_id"]
        )
        assert mực_after_payment["stock_quantity"] == 9.5

        paid_orders = client.get("/api/sales/orders?status=PAID")
        assert paid_orders.status_code == 200
        assert [row["id"] for row in paid_orders.json()] == [order["id"]]

        open_after_payment = client.get("/api/sales/orders?status=OPEN")
        assert open_after_payment.status_code == 200
        assert open_after_payment.json() == []

        funds_after_payment = client.get(
            "/api/fund-accounts?type=CASH"
        ).json()
        fund_after_payment = next(
            row for row in funds_after_payment
            if row["id"] == ids["fund_account_id"]
        )
        assert fund_after_payment["current_balance"] == 149_000


def test_unpaid_sale_delete_restores_stock_without_creating_money_entry(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        ids = seed_sale_data(db_path)

        created = client.post(
            "/api/sales/orders",
            json={
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 1,
                    }
                ]
            },
        )
        assert created.status_code == 201
        order = created.json()

        stock = client.get("/api/inventory/stock").json()
        mực = next(row for row in stock if row["item_id"] == ids["item_id"])
        assert mực["stock_quantity"] == 9.5

        deleted = client.delete(
            f"/api/sales/orders/{order['id']}?reason=Khách hủy trước thanh toán"
        )
        assert deleted.status_code == 200
        assert deleted.json()["status"] == "VOID"

        stock_after_delete = client.get("/api/inventory/stock").json()
        mực_after_delete = next(
            row for row in stock_after_delete
            if row["item_id"] == ids["item_id"]
        )
        assert mực_after_delete["stock_quantity"] == 10

        funds = client.get("/api/fund-accounts?type=CASH").json()
        fund = next(row for row in funds if row["id"] == ids["fund_account_id"])
        assert fund["current_balance"] == 0

    with sqlite3.connect(db_path) as connection:
        payments = connection.execute(
            """
            SELECT COUNT(*)
            FROM fund_transactions
            WHERE source_type = 'SALE'
              AND source_id = ?
            """,
            (str(order["id"]),),
        ).fetchone()[0]
        assert payments == 0


def test_sale_surcharges_are_added_to_total_without_extra_stock_deduction(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        ids = seed_sale_data(db_path)

        created = client.post(
            "/api/sales/orders",
            json={
                "order_time": "2026-10-06T19:00:00",
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 2,
                        "surcharges": [
                            {
                                "name": "Thêm sốt đặc biệt",
                                "amount": 20_000,
                            }
                        ],
                    }
                ],
                "surcharges": [
                    {
                        "name": "Phụ thu phục vụ",
                        "amount": 10_000,
                    }
                ],
            },
        )
        assert created.status_code == 201
        order = created.json()
        assert order["total_amount"] == 330_000
        assert order["surcharge_total"] == 30_000
        assert order["surcharges"] == [
            {
                "id": order["surcharges"][0]["id"],
                "name": "Phụ thu phục vụ",
                "amount": 10_000,
            }
        ]

        line = order["items"][0]
        assert line["line_total"] == 300_000
        assert line["surcharge_total"] == 20_000
        assert line["total_with_surcharges"] == 320_000
        assert line["surcharges"][0]["name"] == "Thêm sốt đặc biệt"
        assert line["surcharges"][0]["amount"] == 20_000

        paid = client.post(
            f"/api/sales/orders/{order['id']}/pay",
            json={
                "fund_account_id": ids["fund_account_id"],
                "actual_received_amount": 330_000,
            },
        )
        assert paid.status_code == 200

        stock = client.get("/api/inventory/stock").json()
        mực = next(row for row in stock if row["item_id"] == ids["item_id"])
        assert mực["stock_quantity"] == 9

        funds = client.get("/api/fund-accounts?type=CASH").json()
        fund = next(row for row in funds if row["id"] == ids["fund_account_id"])
        assert fund["current_balance"] == 330_000

    with sqlite3.connect(db_path) as connection:
        item_surcharges = connection.execute(
            """
            SELECT name, amount
            FROM sales_order_item_surcharges
            ORDER BY id
            """
        ).fetchall()
        order_surcharges = connection.execute(
            """
            SELECT name, amount
            FROM sales_order_surcharges
            ORDER BY id
            """
        ).fetchall()
        assert item_surcharges == [("Thêm sốt đặc biệt", 20_000)]
        assert order_surcharges == [("Phụ thu phục vụ", 10_000)]

def test_paid_sale_can_be_edited_and_deleted_before_einvoice(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        ids = seed_sale_data(db_path)

        created = client.post(
            "/api/sales/orders",
            json={
                "order_time": "2026-10-06T18:00:00",
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 2,
                    }
                ],
            },
        )
        assert created.status_code == 201
        order = created.json()

        paid = client.post(
            f"/api/sales/orders/{order['id']}/pay",
            json={
                "fund_account_id": ids["fund_account_id"],
                "actual_received_amount": 300_000,
            },
        )
        assert paid.status_code == 200

        edited = client.put(
            f"/api/sales/orders/{order['id']}",
            json={
                "order_time": "2026-10-06T18:00:00",
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 1,
                        "surcharges": [
                            {
                                "name": "Phụ thu món",
                                "amount": 20_000,
                            }
                        ],
                    }
                ],
                "fund_account_id": ids["fund_account_id"],
                "actual_received_amount": 170_000,
            },
        )
        assert edited.status_code == 200
        edited_order = edited.json()
        assert edited_order["status"] == "PAID"
        assert edited_order["total_amount"] == 170_000
        assert edited_order["actual_received_amount"] == 170_000
        assert edited_order["has_einvoice"] is False
        assert edited_order["can_edit"] is True
        assert edited_order["can_delete"] is True

        stock = client.get("/api/inventory/stock").json()
        mực = next(row for row in stock if row["item_id"] == ids["item_id"])
        assert mực["stock_quantity"] == 9.5

        funds = client.get("/api/fund-accounts?type=CASH").json()
        fund = next(row for row in funds if row["id"] == ids["fund_account_id"])
        assert fund["current_balance"] == 170_000

        deleted = client.delete(
            f"/api/sales/orders/{order['id']}?reason=Khách hủy"
        )
        assert deleted.status_code == 200
        deleted_order = deleted.json()
        assert deleted_order["status"] == "VOID"
        assert deleted_order["can_edit"] is False
        assert deleted_order["can_delete"] is False

        stock_after_delete = client.get("/api/inventory/stock").json()
        mực_after_delete = next(
            row for row in stock_after_delete if row["item_id"] == ids["item_id"]
        )
        assert mực_after_delete["stock_quantity"] == 10

        funds_after_delete = client.get("/api/fund-accounts?type=CASH").json()
        fund_after_delete = next(
            row for row in funds_after_delete
            if row["id"] == ids["fund_account_id"]
        )
        assert fund_after_delete["current_balance"] == 0

    with sqlite3.connect(db_path) as connection:
        payments = connection.execute(
            """
            SELECT amount, is_void
            FROM fund_transactions
            WHERE source_type = 'SALE'
              AND source_id = ?
            ORDER BY id
            """,
            (str(order["id"]),),
        ).fetchall()
        assert payments == [
            (300_000, 1),
            (170_000, 1),
        ]

        revisions = connection.execute(
            """
            SELECT action, previous_total_amount, new_total_amount
            FROM sales_order_revisions
            WHERE sales_order_id = ?
            ORDER BY id
            """,
            (order["id"],),
        ).fetchall()
        assert revisions == [
            ("UPDATE", 300_000, 170_000),
            ("DELETE", 170_000, None),
        ]


def test_paid_sale_can_be_changed_back_to_debt_without_restoring_stock(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        ids = seed_sale_data(db_path)

        created = client.post(
            "/api/sales/orders",
            json={
                "order_time": "2026-10-06T18:00:00",
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 1,
                    }
                ],
            },
        )
        assert created.status_code == 201
        order = created.json()
        assert order["status"] == "OPEN"
        assert order["stock_deducted"] is True

        paid = client.post(
            f"/api/sales/orders/{order['id']}/pay",
            json={
                "fund_account_id": ids["fund_account_id"],
                "actual_received_amount": 150_000,
            },
        )
        assert paid.status_code == 200
        assert paid.json()["status"] == "PAID"

        changed = client.put(
            f"/api/sales/orders/{order['id']}",
            json={
                "order_time": "2026-10-06T18:00:00",
                "payment_status": "DEBT",
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 1,
                    }
                ],
            },
        )
        assert changed.status_code == 200
        debt = changed.json()
        assert debt["status"] == "OPEN"
        assert debt["fund_account_id"] is None
        assert debt["actual_received_amount"] is None
        assert debt["payment_reference_code"] is None
        assert debt["paid_at"] is None
        assert debt["stock_deducted"] is True

        stock = client.get("/api/inventory/stock").json()
        mực = next(row for row in stock if row["item_id"] == ids["item_id"])
        assert mực["stock_quantity"] == 9.5

        funds = client.get("/api/fund-accounts?type=CASH").json()
        fund = next(row for row in funds if row["id"] == ids["fund_account_id"])
        assert fund["current_balance"] == 0

        paid_again = client.put(
            f"/api/sales/orders/{order['id']}",
            json={
                "order_time": "2026-10-06T18:00:00",
                "payment_status": "PAID",
                "fund_account_id": ids["fund_account_id"],
                "actual_received_amount": 149_000,
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 1,
                    }
                ],
            },
        )
        assert paid_again.status_code == 200
        paid_again_order = paid_again.json()
        assert paid_again_order["status"] == "PAID"
        assert paid_again_order["actual_received_amount"] == 149_000
        assert paid_again_order["stock_deducted"] is True

        stock_after = client.get("/api/inventory/stock").json()
        mực_after = next(
            row for row in stock_after if row["item_id"] == ids["item_id"]
        )
        assert mực_after["stock_quantity"] == 9.5

        funds_after = client.get("/api/fund-accounts?type=CASH").json()
        fund_after = next(
            row for row in funds_after if row["id"] == ids["fund_account_id"]
        )
        assert fund_after["current_balance"] == 149_000


def test_issued_einvoice_locks_sale_edit_and_delete(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        ids = seed_sale_data(db_path)

        created = client.post(
            "/api/sales/orders",
            json={
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 1,
                    }
                ]
            },
        )
        assert created.status_code == 201
        order = created.json()

        with sqlite3.connect(db_path) as connection:
            connection.execute(
                """
                INSERT INTO electronic_invoices (
                    sales_order_id,
                    provider,
                    status,
                    invoice_series,
                    invoice_number,
                    issued_at
                )
                VALUES (?, 'MISA_MEINVOICE', 'ISSUED', '1C26TAA', '00000001', ?)
                """,
                (order["id"], "2026-10-06T20:00:00"),
            )
            connection.commit()

        fresh = client.get(f"/api/sales/orders/{order['id']}")
        assert fresh.status_code == 200
        locked = fresh.json()
        assert locked["has_einvoice"] is True
        assert locked["can_edit"] is False
        assert locked["can_delete"] is False

        edited = client.put(
            f"/api/sales/orders/{order['id']}",
            json={
                "items": [
                    {
                        "menu_item_id": ids["menu_item_id"],
                        "quantity": 2,
                    }
                ]
            },
        )
        assert edited.status_code == 409
        assert "hóa đơn điện tử" in edited.json()["detail"].lower()

        deleted = client.delete(f"/api/sales/orders/{order['id']}")
        assert deleted.status_code == 409
        assert "hóa đơn điện tử" in deleted.json()["detail"].lower()

        unchanged = client.get(f"/api/sales/orders/{order['id']}").json()
        assert unchanged["status"] == "OPEN"
        assert unchanged["total_amount"] == 150_000



def test_sales_order_list_exposes_bank_fund_type_and_keeps_filter(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        ids = seed_sale_data(db_path)
        with sqlite3.connect(db_path) as connection:
            cursor = connection.execute(
                """
                INSERT INTO fund_accounts (
                    name, type, current_balance, is_active, is_default
                ) VALUES ('BIDV', 'BANK', 0, 1, 1)
                """
            )
            bank_id = cursor.lastrowid

        created = client.post(
            "/api/sales/orders",
            json={
                "order_time": "2026-10-06T19:00:00",
                "items": [
                    {"menu_item_id": ids["menu_item_id"], "quantity": 1}
                ],
            },
        )
        assert created.status_code == 201
        order_id = created.json()["id"]
        assert created.json()["fund_account_type"] is None

        paid = client.post(
            f"/api/sales/orders/{order_id}/pay",
            json={
                "fund_account_id": bank_id,
                "actual_received_amount": 150_000,
            },
        )
        assert paid.status_code == 200, paid.text
        assert paid.json()["fund_account_name"] == "BIDV"
        assert paid.json()["fund_account_type"] == "BANK"

        listed = client.get("/api/sales/orders")
        assert listed.status_code == 200
        order = next(x for x in listed.json() if x["id"] == order_id)
        assert order["fund_account_type"] == "BANK"
        assert order["fund_account_name"] == "BIDV"

        bank_filtered = client.get(
            "/api/sales/orders", params={"fund_account_id": bank_id}
        )
        assert bank_filtered.status_code == 200
        assert [x["id"] for x in bank_filtered.json()] == [order_id]

        cash_filtered = client.get(
            "/api/sales/orders",
            params={"fund_account_id": ids["fund_account_id"]},
        )
        assert cash_filtered.status_code == 200
        assert cash_filtered.json() == []



def test_shared_web_and_pos_debt_closes_sale_without_fund_receipt(tmp_path, monkeypatch):
    """The Web edit path and POS checkout share the same receivable status."""
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        ids = seed_sale_data(db_path)
        customer = client.post("/api/pos/customers", json={
            "name": "Khách ghi nợ", "phone": "0911888999",
        })
        assert customer.status_code == 201, customer.text
        customer_id = customer.json()["id"]
        created = client.post("/api/sales/orders", json={
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        })
        assert created.status_code == 201
        order = created.json()
        assert order["status"] == "OPEN"
        assert client.get("/api/sales/orders?status=DEBT").json() == []

        missing_customer = client.put(f"/api/sales/orders/{order['id']}", json={
            "settlement_target": "DEBT",
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        })
        assert missing_customer.status_code == 422
        assert client.get(f"/api/sales/orders/{order['id']}").json()["status"] == "OPEN"

        closed = client.put(f"/api/sales/orders/{order['id']}", json={
            "settlement_target": "DEBT",
            "customer_id": customer_id,
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        })
        assert closed.status_code == 200, closed.text
        debt = closed.json()
        assert debt["status"] == "PAID"
        assert debt["settlement_status"] == "DEBT"
        assert debt["customer_id"] == customer_id
        assert debt["fund_account_id"] is None
        assert debt["paid_at"] is None
        assert client.get("/api/sales/orders?status=OPEN").json() == []
        assert [row["id"] for row in client.get("/api/sales/orders?status=DEBT").json()] == [order["id"]]
        assert client.get("/api/sales/orders?status=PAID").json() == []

        with sqlite3.connect(db_path) as connection:
            assert connection.execute(
                "SELECT COUNT(*) FROM fund_transactions WHERE source_type='SALE' AND is_void=0"
            ).fetchone()[0] == 0

        # The existing POS /pay contract collects this same Web debt exactly once.
        paid = client.post(f"/api/sales/orders/{order['id']}/pay", json={
            "payment_method": "CASH",
            "fund_account_id": ids["fund_account_id"],
            "expected_total_amount": 150_000,
        })
        assert paid.status_code == 200, paid.text
        assert paid.json()["settlement_status"] == "PAID"
        assert len(client.get("/api/sales/orders?status=DEBT").json()) == 0
        assert [row["id"] for row in client.get("/api/sales/orders?status=PAID").json()] == [order["id"]]
        assert client.post(f"/api/sales/orders/{order['id']}/pay", json={
            "payment_method": "CASH", "fund_account_id": ids["fund_account_id"]
        }).status_code == 409

        with sqlite3.connect(db_path) as connection:
            assert connection.execute(
                "SELECT COUNT(*) FROM fund_transactions WHERE source_type='SALE' AND is_void=0"
            ).fetchone()[0] == 1
        stock = client.get("/api/inventory/stock").json()
        mực = next(row for row in stock if row["item_id"] == ids["item_id"])
        assert mực["stock_quantity"] == 9.5


def test_web_edit_paid_into_debt_reverses_fund_without_restoring_sold_stock(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        ids = seed_sale_data(db_path)
        customer_id = client.post("/api/pos/customers", json={
            "name": "Khách A"
        }).json()["id"]
        created = client.post("/api/sales/orders", json={
            "customer_id": customer_id,
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        }).json()
        paid = client.post(f"/api/sales/orders/{created['id']}/pay", json={
            "fund_account_id": ids["fund_account_id"], "actual_received_amount": 150_000
        })
        assert paid.status_code == 200
        switched = client.put(f"/api/sales/orders/{created['id']}", json={
            "customer_id": customer_id,
            "settlement_target": "DEBT",
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        })
        assert switched.status_code == 200, switched.text
        assert switched.json()["status"] == "PAID"
        assert switched.json()["settlement_status"] == "DEBT"
        with sqlite3.connect(db_path) as connection:
            assert connection.execute(
                "SELECT current_balance FROM fund_accounts WHERE id = ?",
                (ids["fund_account_id"],)
            ).fetchone()[0] == 0
            assert connection.execute(
                "SELECT COUNT(*) FROM fund_transactions WHERE source_type='SALE' AND is_void=0"
            ).fetchone()[0] == 0
        stock = client.get("/api/inventory/stock").json()
        assert next(row for row in stock if row["item_id"] == ids["item_id"])["stock_quantity"] == 9.5


def test_edit_closed_debt_when_table_reused_does_not_reopen_or_steal_table(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        ids = seed_sale_data(db_path)
        area = client.post("/api/pos/areas", json={"name": "Sân"}).json()
        table = client.post("/api/pos/tables", json={
            "area_id": area["id"], "name": "Bàn 1", "is_active": True,
        }).json()
        customer_id = client.post("/api/pos/customers", json={
            "name": "Khách ghi sổ"
        }).json()["id"]
        first = client.post("/api/sales/orders", json={
            "order_type": "DINE_IN", "table_id": table["id"],
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        }).json()
        debt = client.post(f"/api/sales/orders/{first['id']}/pay", json={
            "payment_method": "DEBT", "customer_id": customer_id,
        })
        assert debt.status_code == 200
        second = client.post("/api/sales/orders", json={
            "order_type": "DINE_IN", "table_id": table["id"],
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        })
        assert second.status_code == 201

        edited = client.put(f"/api/sales/orders/{first['id']}", json={
            "order_type": "DINE_IN", "table_id": table["id"],
            "customer_id": customer_id, "settlement_target": "DEBT",
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        })
        assert edited.status_code == 200, edited.text
        assert edited.json()["status"] == "PAID"
        assert edited.json()["settlement_status"] == "DEBT"
        occupied = client.get("/api/pos/tables").json()
        assert occupied[0]["open_order_id"] == second.json()["id"]
        refused = client.put(f"/api/sales/orders/{first['id']}", json={
            "order_type": "DINE_IN", "table_id": table["id"],
            "customer_id": customer_id, "settlement_target": "OPEN",
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        })
        assert refused.status_code == 409
        assert client.get(f"/api/sales/orders/{first['id']}").json()["settlement_status"] == "DEBT"


def test_legacy_debt_edit_keeps_open_sales_open(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        ids = seed_sale_data(db_path)
        order = client.post("/api/sales/orders", json={
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        }).json()
        # An older installed POS/Web build uses payment_status=DEBT to save OPEN.
        edited = client.put(f"/api/sales/orders/{order['id']}", json={
            "payment_status": "DEBT",
            "items": [{"menu_item_id": ids["menu_item_id"], "quantity": 1}],
        })
        assert edited.status_code == 200, edited.text
        assert edited.json()["status"] == "OPEN"
        assert client.get("/api/sales/orders?status=DEBT").json() == []
