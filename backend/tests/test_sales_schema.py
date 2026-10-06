import sqlite3

import pytest

from backend.app.database import init_db


def test_sales_schema_is_created(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    init_db()

    with sqlite3.connect(db_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        assert "sales_orders" in tables
        assert "sales_order_items" in tables

        order_columns = {
            row[1]
            for row in connection.execute(
                "PRAGMA table_info(sales_orders)"
            ).fetchall()
        }
        assert {
            "order_code",
            "order_time",
            "status",
            "fund_account_id",
            "total_amount",
            "actual_received_amount",
            "payment_reference_code",
            "paid_at",
            "void_reason",
            "voided_at",
        }.issubset(order_columns)

        line_columns = {
            row[1]
            for row in connection.execute(
                "PRAGMA table_info(sales_order_items)"
            ).fetchall()
        }
        assert {
            "sales_order_id",
            "menu_item_id",
            "menu_item_option_id",
            "item_name_snapshot",
            "option_name_snapshot",
            "unit_name_snapshot",
            "quantity",
            "unit_price",
            "line_total",
            "unit_cost_snapshot",
            "cost_total_snapshot",
        }.issubset(line_columns)

        category = connection.execute(
            """
            SELECT direction
            FROM fund_transaction_categories
            WHERE name = 'Bán hàng' COLLATE NOCASE
            """
        ).fetchone()
        assert category is not None
        assert category[0] == "IN"

        sale_index = connection.execute(
            """
            SELECT sql
            FROM sqlite_master
            WHERE type = 'index'
              AND name = 'ux_fund_transactions_sale_active'
            """
        ).fetchone()
        assert sale_index is not None
        assert "source_type = 'SALE'" in sale_index[0]


def test_sales_order_status_check_is_enforced(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    init_db()

    with sqlite3.connect(db_path) as connection:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO sales_orders (
                    order_code,
                    order_time,
                    status
                )
                VALUES ('BH000001', '2026-10-06T18:00', 'INVALID')
                """
            )


def test_sale_line_keeps_snapshot_when_menu_option_is_deleted(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    init_db()

    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            "INSERT INTO units (name, is_active) VALUES ('đĩa', 1)"
        )
        unit_id = connection.execute(
            "SELECT id FROM units WHERE name = 'đĩa'"
        ).fetchone()[0]

        connection.execute(
            """
            INSERT INTO menu_groups (name, display_order, is_active)
            VALUES ('Món test', 0, 1)
            """
        )
        group_id = connection.execute(
            "SELECT id FROM menu_groups WHERE name = 'Món test'"
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
            (group_id, unit_id),
        )
        menu_item_id = connection.execute(
            "SELECT id FROM menu_items WHERE name = 'Mực hấp'"
        ).fetchone()[0]

        connection.execute(
            """
            INSERT INTO service_options (name, is_active)
            VALUES ('Hấp', 1)
            """
        )
        service_option_id = connection.execute(
            "SELECT id FROM service_options WHERE name = 'Hấp'"
        ).fetchone()[0]

        connection.execute(
            """
            INSERT INTO menu_item_options (
                menu_item_id,
                service_option_id,
                extra_price,
                is_active
            )
            VALUES (?, ?, 0, 1)
            """,
            (menu_item_id, service_option_id),
        )
        option_id = connection.execute(
            "SELECT id FROM menu_item_options WHERE menu_item_id = ?",
            (menu_item_id,),
        ).fetchone()[0]

        connection.execute(
            """
            INSERT INTO sales_orders (
                order_code,
                order_time,
                status,
                total_amount
            )
            VALUES ('BH000001', '2026-10-06T18:00', 'OPEN', 150000)
            """
        )
        order_id = connection.execute(
            "SELECT id FROM sales_orders WHERE order_code = 'BH000001'"
        ).fetchone()[0]

        connection.execute(
            """
            INSERT INTO sales_order_items (
                sales_order_id,
                menu_item_id,
                menu_item_option_id,
                item_name_snapshot,
                option_name_snapshot,
                unit_name_snapshot,
                quantity,
                unit_price,
                line_total
            )
            VALUES (?, ?, ?, 'Mực hấp', 'Hấp', 'đĩa', 1, 150000, 150000)
            """,
            (order_id, menu_item_id, option_id),
        )

        connection.execute(
            "DELETE FROM menu_item_options WHERE id = ?",
            (option_id,),
        )

        row = connection.execute(
            """
            SELECT
                menu_item_option_id,
                item_name_snapshot,
                option_name_snapshot
            FROM sales_order_items
            WHERE sales_order_id = ?
            """,
            (order_id,),
        ).fetchone()

        assert row[0] is None
        assert row[1] == "Mực hấp"
        assert row[2] == "Hấp"
