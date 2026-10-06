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
        assert order["total_amount"] == 300_000
        assert order["stock_deducted"] is False

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


def test_sale_payment_is_rolled_back_when_menu_has_no_stock_recipe(
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
        assert created.status_code == 201
        order = created.json()

        paid = client.post(
            f"/api/sales/orders/{order['id']}/pay",
            json={
                "fund_account_id": ids["fund_account_id"],
                "actual_received_amount": 150_000,
            },
        )
        assert paid.status_code == 409
        assert "nguyên liệu" in paid.json()["detail"].lower()

        fresh = client.get(f"/api/sales/orders/{order['id']}")
        assert fresh.status_code == 200
        assert fresh.json()["status"] == "OPEN"
        assert fresh.json()["stock_deducted"] is False

        funds = client.get("/api/fund-accounts?type=CASH").json()
        fund = next(row for row in funds if row["id"] == ids["fund_account_id"])
        assert fund["current_balance"] == 0

    with sqlite3.connect(db_path) as connection:
        sale_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM inventory_movements
            WHERE source_type = 'SALE'
              AND source_id = ?
            """,
            (str(order["id"]),),
        ).fetchone()[0]
        payment_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM fund_transactions
            WHERE source_type = 'SALE'
              AND source_id = ?
            """,
            (str(order["id"]),),
        ).fetchone()[0]

        assert sale_count == 0
        assert payment_count == 0

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

