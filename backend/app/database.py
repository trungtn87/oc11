import os
import sqlite3
import sys
from pathlib import Path


def get_db_path() -> Path:
    configured = os.getenv("OC11_DB_PATH")
    if configured:
        return Path(configured)

    if getattr(sys, "frozen", False):
        portable_root = Path(
            os.getenv("OC11_PORTABLE_ROOT", str(Path(sys.executable).resolve().parent))
        )
        return portable_root / "data" / "oc11.db"

    return Path(__file__).resolve().parents[1] / "data" / "oc11.db"


def connect() -> sqlite3.Connection:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(db_path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def migrate_legacy_items(connection: sqlite3.Connection) -> None:
    table = connection.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'items'
        """
    ).fetchone()

    if table is None:
        return

    columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(items)").fetchall()
    }

    if "default_unit_id" in columns and "smallest_unit_id" in columns:
        return

    if "unit_id" not in columns:
        return

    connection.execute("PRAGMA foreign_keys = OFF")
    connection.execute(
        """
        CREATE TABLE items_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            item_group_id INTEGER NOT NULL,
            default_unit_id INTEGER NOT NULL,
            smallest_unit_id INTEGER NOT NULL,
            note TEXT,
            is_active INTEGER NOT NULL DEFAULT 1
                CHECK (is_active IN (0, 1)),
            FOREIGN KEY (item_group_id) REFERENCES item_groups(id),
            FOREIGN KEY (default_unit_id) REFERENCES units(id),
            FOREIGN KEY (smallest_unit_id) REFERENCES units(id)
        )
        """
    )
    connection.execute(
        """
        INSERT INTO items_v2 (
            id,
            name,
            item_group_id,
            default_unit_id,
            smallest_unit_id,
            note,
            is_active
        )
        SELECT
            id,
            name,
            item_group_id,
            unit_id,
            unit_id,
            note,
            is_active
        FROM items
        """
    )
    connection.execute("DROP TABLE items")
    connection.execute("ALTER TABLE items_v2 RENAME TO items")
    connection.execute("PRAGMA foreign_keys = ON")


def init_db() -> None:
    with connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS employees (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                phone TEXT,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                note TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS fund_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL
                    CHECK (type IN ('CASH', 'BANK')),
                bank_name TEXT,
                account_number TEXT,
                account_name TEXT,
                current_balance INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                note TEXT
            )
            """
        )
        fund_columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(fund_accounts)").fetchall()
        }
        for column_name in ("bank_name", "account_number", "account_name"):
            if column_name not in fund_columns:
                connection.execute(
                    f"ALTER TABLE fund_accounts ADD COLUMN {column_name} TEXT"
                )

        fund_columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(fund_accounts)").fetchall()
        }
        if "is_default" not in fund_columns:
            connection.execute(
                """
                ALTER TABLE fund_accounts
                ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
                    CHECK (is_default IN (0, 1))
                """
            )

        for account_type in ("CASH", "BANK"):
            has_default = connection.execute(
                """
                SELECT 1
                FROM fund_accounts
                WHERE type = ? AND is_default = 1
                LIMIT 1
                """,
                (account_type,),
            ).fetchone()
            if has_default is None:
                first_active = connection.execute(
                    """
                    SELECT id
                    FROM fund_accounts
                    WHERE type = ? AND is_active = 1
                    ORDER BY id ASC
                    LIMIT 1
                    """,
                    (account_type,),
                ).fetchone()
                if first_active is not None:
                    connection.execute(
                        "UPDATE fund_accounts SET is_default = 1 WHERE id = ?",
                        (first_active["id"],),
                    )

        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_fund_accounts_default_type
            ON fund_accounts (type)
            WHERE is_default = 1
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS fund_transaction_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE,
                direction TEXT NOT NULL
                    CHECK (direction IN ('IN', 'OUT')),
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (name, direction)
            )
            """
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO fund_transaction_categories (
                name, direction, is_active, sort_order
            )
            VALUES ('Thanh toán nhà cung cấp', 'OUT', 1, 0)
            """
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO fund_transaction_categories (
                name, direction, is_active, sort_order
            )
            VALUES ('Bán hàng', 'IN', 1, 0)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS fund_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fund_account_id INTEGER NOT NULL,
                transaction_time TEXT NOT NULL,
                transaction_type TEXT NOT NULL,
                direction TEXT NOT NULL
                    CHECK (direction IN ('IN', 'OUT')),
                amount INTEGER NOT NULL
                    CHECK (amount > 0),
                source_type TEXT,
                source_id TEXT,
                reference_code TEXT,
                group_id TEXT,
                counterparty_name TEXT,
                description TEXT,
                note TEXT,
                employee_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                is_void INTEGER NOT NULL DEFAULT 0
                    CHECK (is_void IN (0, 1)),
                FOREIGN KEY (fund_account_id) REFERENCES fund_accounts(id),
                FOREIGN KEY (employee_id) REFERENCES employees(id)
            )
            """
        )

        fund_transaction_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(fund_transactions)"
            ).fetchall()
        }
        if "category_id" not in fund_transaction_columns:
            connection.execute(
                """
                ALTER TABLE fund_transactions
                ADD COLUMN category_id INTEGER
                REFERENCES fund_transaction_categories(id)
                """
            )
        if "source_component" not in fund_transaction_columns:
            connection.execute(
                """
                ALTER TABLE fund_transactions
                ADD COLUMN source_component TEXT
                """
            )


        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS item_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                note TEXT,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1))
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS suppliers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                address TEXT,
                note TEXT,
                bank_name TEXT,
                bank_account_number TEXT,
                bank_account_name TEXT,
                payment_qr_image TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS units (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1))
            )
            """
        )

        migrate_legacy_items(connection)

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                item_group_id INTEGER NOT NULL,
                default_unit_id INTEGER NOT NULL,
                smallest_unit_id INTEGER NOT NULL,
                note TEXT,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                FOREIGN KEY (item_group_id) REFERENCES item_groups(id),
                FOREIGN KEY (default_unit_id) REFERENCES units(id),
                FOREIGN KEY (smallest_unit_id) REFERENCES units(id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS item_unit_conversions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL,
                unit_id INTEGER NOT NULL,
                quantity_in_smallest_unit REAL NOT NULL
                    CHECK (quantity_in_smallest_unit > 0),
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
                FOREIGN KEY (unit_id) REFERENCES units(id),
                UNIQUE (item_id, unit_id)
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS service_options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                note TEXT,
                display_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1))
            )
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_service_options_name_nocase
            ON service_options (name COLLATE NOCASE)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_option_id INTEGER NOT NULL UNIQUE,
                output_quantity REAL NOT NULL CHECK (output_quantity > 0),
                output_unit_id INTEGER NOT NULL,
                waste_percent REAL NOT NULL DEFAULT 5
                    CHECK (waste_percent >= 0 AND waste_percent <= 100),
                alert_threshold_percent REAL NOT NULL DEFAULT 5
                    CHECK (
                        alert_threshold_percent > 0
                        AND alert_threshold_percent <= 100
                    ),
                reference_unit_cost REAL,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                FOREIGN KEY (service_option_id)
                    REFERENCES service_options(id) ON DELETE CASCADE,
                FOREIGN KEY (output_unit_id) REFERENCES units(id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS recipe_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,
                unit_id INTEGER NOT NULL,
                quantity REAL NOT NULL CHECK (quantity > 0),
                FOREIGN KEY (recipe_id)
                    REFERENCES recipes(id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES items(id),
                FOREIGN KEY (unit_id) REFERENCES units(id),
                UNIQUE (recipe_id, item_id, unit_id)
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_recipe_items_item
            ON recipe_items (item_id, recipe_id)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS cost_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id INTEGER NOT NULL,
                reference_unit_cost REAL NOT NULL,
                current_unit_cost REAL NOT NULL,
                change_percent REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'RESOLVED')),
                detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                resolved_at TEXT,
                FOREIGN KEY (recipe_id)
                    REFERENCES recipes(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_cost_alerts_open_recipe
            ON cost_alerts (recipe_id)
            WHERE status = 'OPEN'
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS menu_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                display_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                note TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_groups_name_nocase
            ON menu_groups (name COLLATE NOCASE)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS menu_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                menu_group_id INTEGER NOT NULL,
                sale_unit_id INTEGER NOT NULL,
                base_price INTEGER NOT NULL DEFAULT 0
                    CHECK (base_price >= 0),
                alert_threshold_percent REAL NOT NULL DEFAULT 3
                    CHECK (
                        alert_threshold_percent > 0
                        AND alert_threshold_percent <= 100
                    ),
                reference_cost REAL,
                display_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                note TEXT,
                FOREIGN KEY (menu_group_id) REFERENCES menu_groups(id),
                FOREIGN KEY (sale_unit_id) REFERENCES units(id)
            )
            """
        )
        menu_item_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(menu_items)"
            ).fetchall()
        }
        if "alert_threshold_percent" not in menu_item_columns:
            connection.execute(
                """
                ALTER TABLE menu_items
                ADD COLUMN alert_threshold_percent REAL NOT NULL DEFAULT 3
            """
            )
        if "reference_cost" not in menu_item_columns:
            connection.execute(
                "ALTER TABLE menu_items ADD COLUMN reference_cost REAL"
            )

        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_items_group_name_nocase
            ON menu_items (menu_group_id, name COLLATE NOCASE)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS menu_item_ingredients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                menu_item_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,
                unit_id INTEGER NOT NULL,
                quantity REAL NOT NULL CHECK (quantity > 0),
                FOREIGN KEY (menu_item_id)
                    REFERENCES menu_items(id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES items(id),
                FOREIGN KEY (unit_id) REFERENCES units(id),
                UNIQUE (menu_item_id, item_id, unit_id)
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_menu_item_ingredients_item
            ON menu_item_ingredients (item_id, menu_item_id)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS menu_item_options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                menu_item_id INTEGER NOT NULL,
                service_option_id INTEGER NOT NULL,
                extra_price INTEGER NOT NULL DEFAULT 0
                    CHECK (extra_price >= 0),
                alert_threshold_percent REAL NOT NULL DEFAULT 5
                    CHECK (
                        alert_threshold_percent > 0
                        AND alert_threshold_percent <= 100
                    ),
                reference_cost REAL,
                display_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                FOREIGN KEY (menu_item_id)
                    REFERENCES menu_items(id) ON DELETE CASCADE,
                FOREIGN KEY (service_option_id)
                    REFERENCES service_options(id),
                UNIQUE (menu_item_id, service_option_id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS menu_item_components (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                menu_item_option_id INTEGER NOT NULL,
                component_type TEXT NOT NULL
                    CHECK (component_type IN ('ITEM', 'RECIPE')),
                item_id INTEGER,
                unit_id INTEGER,
                recipe_id INTEGER,
                quantity REAL NOT NULL CHECK (quantity > 0),
                FOREIGN KEY (menu_item_option_id)
                    REFERENCES menu_item_options(id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES items(id),
                FOREIGN KEY (unit_id) REFERENCES units(id),
                FOREIGN KEY (recipe_id) REFERENCES recipes(id),
                CHECK (
                    (
                        component_type = 'ITEM'
                        AND item_id IS NOT NULL
                        AND unit_id IS NOT NULL
                        AND recipe_id IS NULL
                    )
                    OR
                    (
                        component_type = 'RECIPE'
                        AND item_id IS NULL
                        AND unit_id IS NULL
                        AND recipe_id IS NOT NULL
                    )
                )
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_menu_item_components_item
            ON menu_item_components (item_id, menu_item_option_id)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_menu_item_components_recipe
            ON menu_item_components (recipe_id, menu_item_option_id)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS menu_item_cost_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                menu_item_id INTEGER NOT NULL,
                reference_cost REAL NOT NULL,
                current_cost REAL NOT NULL,
                change_percent REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'RESOLVED')),
                detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                resolved_at TEXT,
                FOREIGN KEY (menu_item_id)
                    REFERENCES menu_items(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_item_cost_alerts_open_item
            ON menu_item_cost_alerts (menu_item_id)
            WHERE status = 'OPEN'
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS menu_cost_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                menu_item_option_id INTEGER NOT NULL,
                reference_cost REAL NOT NULL,
                current_cost REAL NOT NULL,
                change_percent REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'RESOLVED')),
                detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                resolved_at TEXT,
                FOREIGN KEY (menu_item_option_id)
                    REFERENCES menu_item_options(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_cost_alerts_open_option
            ON menu_cost_alerts (menu_item_option_id)
            WHERE status = 'OPEN'
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_code TEXT NOT NULL UNIQUE,
                customer_type TEXT NOT NULL DEFAULT 'PERSON'
                    CHECK (customer_type IN ('PERSON', 'ORGANIZATION')),
                name TEXT NOT NULL,
                tax_code TEXT,
                address TEXT,
                phone TEXT,
                email TEXT,
                contact_name TEXT,
                bank_account TEXT,
                bank_name TEXT,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT,
                CHECK (
                    tax_code IS NULL
                    OR TRIM(tax_code) = ''
                    OR (
                        address IS NOT NULL
                        AND TRIM(address) <> ''
                    )
                )
            )
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_tax_code
            ON customers (tax_code)
            WHERE tax_code IS NOT NULL
              AND TRIM(tax_code) <> ''
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_customers_name_phone
            ON customers (name, phone)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS restaurant_areas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE,
                display_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_restaurant_areas_name
            ON restaurant_areas (name COLLATE NOCASE)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS restaurant_tables (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                area_id INTEGER NOT NULL,
                name TEXT NOT NULL COLLATE NOCASE,
                seats INTEGER NOT NULL DEFAULT 4 CHECK (seats >= 0),
                display_order INTEGER NOT NULL DEFAULT 0,
                pos_x REAL NOT NULL DEFAULT 0,
                pos_y REAL NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT,
                FOREIGN KEY (area_id) REFERENCES restaurant_areas(id)
            )
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_restaurant_tables_area_name
            ON restaurant_tables (area_id, name COLLATE NOCASE)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_restaurant_tables_area
            ON restaurant_tables (area_id, is_active, display_order, id)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sales_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_code TEXT NOT NULL UNIQUE,
                order_time TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'PAID', 'VOID')),
                order_type TEXT NOT NULL DEFAULT 'TAKEAWAY'
                    CHECK (order_type IN ('DINE_IN', 'TAKEAWAY')),
                table_id INTEGER,
                guest_count INTEGER NOT NULL DEFAULT 0
                    CHECK (guest_count >= 0),
                kitchen_sent_at TEXT,
                customer_id INTEGER,
                fund_account_id INTEGER,
                total_amount INTEGER NOT NULL DEFAULT 0
                    CHECK (total_amount >= 0),
                actual_received_amount INTEGER
                    CHECK (
                        actual_received_amount IS NULL
                        OR actual_received_amount >= 0
                    ),
                payment_reference_code TEXT,
                paid_at TEXT,
                note TEXT,
                void_reason TEXT,
                voided_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT,
                FOREIGN KEY (customer_id) REFERENCES customers(id),
                FOREIGN KEY (fund_account_id) REFERENCES fund_accounts(id),
                FOREIGN KEY (table_id) REFERENCES restaurant_tables(id)
            )
            """
        )

        sales_order_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(sales_orders)"
            ).fetchall()
        }
        if "customer_id" not in sales_order_columns:
            connection.execute(
                """
                ALTER TABLE sales_orders
                ADD COLUMN customer_id INTEGER
                    REFERENCES customers(id)
                """
            )
        if "order_type" not in sales_order_columns:
            connection.execute(
                """
                ALTER TABLE sales_orders
                ADD COLUMN order_type TEXT NOT NULL DEFAULT 'TAKEAWAY'
                    CHECK (order_type IN ('DINE_IN', 'TAKEAWAY'))
                """
            )
        if "table_id" not in sales_order_columns:
            connection.execute(
                """
                ALTER TABLE sales_orders
                ADD COLUMN table_id INTEGER
                    REFERENCES restaurant_tables(id)
                """
            )
        if "guest_count" not in sales_order_columns:
            connection.execute(
                """
                ALTER TABLE sales_orders
                ADD COLUMN guest_count INTEGER NOT NULL DEFAULT 0
                    CHECK (guest_count >= 0)
                """
            )
        if "kitchen_sent_at" not in sales_order_columns:
            connection.execute(
                "ALTER TABLE sales_orders ADD COLUMN kitchen_sent_at TEXT"
            )

        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_orders_open_table
            ON sales_orders (table_id)
            WHERE status = 'OPEN' AND table_id IS NOT NULL
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sales_orders_time_status
            ON sales_orders (order_time, status)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sales_orders_customer
            ON sales_orders (customer_id, order_time)
            WHERE customer_id IS NOT NULL
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sales_order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sales_order_id INTEGER NOT NULL,
                menu_item_id INTEGER,
                menu_item_option_id INTEGER,
                item_name_snapshot TEXT NOT NULL,
                option_name_snapshot TEXT,
                unit_name_snapshot TEXT NOT NULL,
                quantity REAL NOT NULL CHECK (quantity > 0),
                unit_price INTEGER NOT NULL DEFAULT 0
                    CHECK (unit_price >= 0),
                line_total INTEGER NOT NULL DEFAULT 0
                    CHECK (line_total >= 0),
                unit_cost_snapshot REAL
                    CHECK (
                        unit_cost_snapshot IS NULL
                        OR unit_cost_snapshot >= 0
                    ),
                cost_total_snapshot REAL
                    CHECK (
                        cost_total_snapshot IS NULL
                        OR cost_total_snapshot >= 0
                    ),
                note TEXT,
                FOREIGN KEY (sales_order_id)
                    REFERENCES sales_orders(id) ON DELETE CASCADE,
                FOREIGN KEY (menu_item_id)
                    REFERENCES menu_items(id) ON DELETE SET NULL,
                FOREIGN KEY (menu_item_option_id)
                    REFERENCES menu_item_options(id) ON DELETE SET NULL
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sales_order_items_order
            ON sales_order_items (sales_order_id, id)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sales_order_items_menu
            ON sales_order_items (menu_item_id, menu_item_option_id)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sales_order_item_surcharges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sales_order_item_id INTEGER NOT NULL,
                name TEXT NOT NULL CHECK (TRIM(name) <> ''),
                amount INTEGER NOT NULL CHECK (amount > 0),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sales_order_item_id)
                    REFERENCES sales_order_items(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sales_order_item_surcharges_line
            ON sales_order_item_surcharges (sales_order_item_id, id)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sales_order_surcharges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sales_order_id INTEGER NOT NULL,
                name TEXT NOT NULL CHECK (TRIM(name) <> ''),
                amount INTEGER NOT NULL CHECK (amount > 0),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sales_order_id)
                    REFERENCES sales_orders(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sales_order_surcharges_order
            ON sales_order_surcharges (sales_order_id, id)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS kitchen_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sales_order_id INTEGER NOT NULL,
                sent_at TEXT NOT NULL,
                printer_name TEXT,
                print_status TEXT NOT NULL
                    CHECK (print_status IN ('PRINTED', 'FAILED')),
                error_message TEXT,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sales_order_id)
                    REFERENCES sales_orders(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_order
            ON kitchen_tickets (sales_order_id, sent_at, id)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS electronic_invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sales_order_id INTEGER NOT NULL,
                provider TEXT NOT NULL DEFAULT 'MISA_MEINVOICE',
                status TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (
                        status IN (
                            'DRAFT',
                            'ISSUED',
                            'CANCELLED',
                            'REPLACED',
                            'ADJUSTED'
                        )
                    ),
                invoice_series TEXT,
                invoice_number TEXT,
                external_id TEXT,
                issued_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT,
                FOREIGN KEY (sales_order_id)
                    REFERENCES sales_orders(id) ON DELETE RESTRICT
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_electronic_invoices_sale
            ON electronic_invoices (sales_order_id, issued_at, id)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sales_order_revisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sales_order_id INTEGER NOT NULL,
                action TEXT NOT NULL
                    CHECK (action IN ('UPDATE', 'DELETE')),
                previous_total_amount INTEGER NOT NULL DEFAULT 0,
                new_total_amount INTEGER,
                reason TEXT,
                snapshot_json TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sales_order_id)
                    REFERENCES sales_orders(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sales_order_revisions_order
            ON sales_order_revisions (sales_order_id, created_at, id)
            """
        )

        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_fund_transactions_sale_active
            ON fund_transactions (source_type, source_id)
            WHERE source_type = 'SALE'
              AND direction = 'IN'
              AND is_void = 0
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS purchase_receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                receipt_code TEXT NOT NULL UNIQUE,
                client_sync_id TEXT,
                supplier_id INTEGER NOT NULL,
                receipt_time TEXT NOT NULL,
                description TEXT,
                goods_total INTEGER NOT NULL DEFAULT 0 CHECK (goods_total >= 0),
                shipping_fee INTEGER NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
                total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
                actual_paid_amount INTEGER CHECK (
                    actual_paid_amount IS NULL OR actual_paid_amount >= 0
                ),
                payment_status TEXT NOT NULL
                    CHECK (payment_status IN ('PAID', 'DEBT')),
                payment_reference_code TEXT,
                replaces_receipt_id INTEGER,
                is_void INTEGER NOT NULL DEFAULT 0
                    CHECK (is_void IN (0, 1)),
                voided_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT,
                FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
                FOREIGN KEY (replaces_receipt_id) REFERENCES purchase_receipts(id)
            )
            """
        )

        purchase_receipt_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(purchase_receipts)"
            ).fetchall()
        }
        if "client_sync_id" not in purchase_receipt_columns:
            connection.execute(
                "ALTER TABLE purchase_receipts ADD COLUMN client_sync_id TEXT"
            )
        if "actual_paid_amount" not in purchase_receipt_columns:
            connection.execute(
                """
                ALTER TABLE purchase_receipts
                ADD COLUMN actual_paid_amount INTEGER
                    CHECK (actual_paid_amount IS NULL OR actual_paid_amount >= 0)
                """
            )
            connection.execute(
                """
                UPDATE purchase_receipts
                SET actual_paid_amount = total_amount
                WHERE payment_status = 'PAID'
                  AND actual_paid_amount IS NULL
                """
            )
        if "replaces_receipt_id" not in purchase_receipt_columns:
            connection.execute(
                "ALTER TABLE purchase_receipts ADD COLUMN replaces_receipt_id INTEGER"
            )
        if "is_void" not in purchase_receipt_columns:
            connection.execute(
                """
                ALTER TABLE purchase_receipts
                ADD COLUMN is_void INTEGER NOT NULL DEFAULT 0
                    CHECK (is_void IN (0, 1))
                """
            )
        if "voided_at" not in purchase_receipt_columns:
            connection.execute(
                "ALTER TABLE purchase_receipts ADD COLUMN voided_at TEXT"
            )
        if "updated_at" not in purchase_receipt_columns:
            connection.execute(
                "ALTER TABLE purchase_receipts ADD COLUMN updated_at TEXT"
            )
            connection.execute(
                """
                UPDATE purchase_receipts
                SET updated_at = created_at
                WHERE updated_at IS NULL
                """
            )

        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_receipts_client_sync_id
            ON purchase_receipts (client_sync_id)
            WHERE client_sync_id IS NOT NULL
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_purchase_receipts_replaces
            ON purchase_receipts (replaces_receipt_id)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS purchase_receipt_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                purchase_receipt_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,
                unit_id INTEGER NOT NULL,
                quantity REAL NOT NULL CHECK (quantity > 0),
                conversion_factor REAL NOT NULL CHECK (conversion_factor > 0),
                quantity_in_smallest_unit REAL NOT NULL
                    CHECK (quantity_in_smallest_unit > 0),
                unit_price INTEGER NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
                line_total INTEGER NOT NULL DEFAULT 0 CHECK (line_total >= 0),
                note TEXT,
                FOREIGN KEY (purchase_receipt_id)
                    REFERENCES purchase_receipts(id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES items(id),
                FOREIGN KEY (unit_id) REFERENCES units(id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL,
                movement_time TEXT NOT NULL,
                quantity_delta REAL NOT NULL,
                source_type TEXT NOT NULL,
                source_id TEXT,
                source_line_id TEXT,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (item_id) REFERENCES items(id)
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_time
            ON inventory_movements (item_id, movement_time)
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_inventory_movements_source
            ON inventory_movements (source_type, source_id, source_line_id)
            """
        )
        connection.execute(
            "DROP INDEX IF EXISTS ux_inventory_sale_source_line"
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_sale_source_line_item
            ON inventory_movements (
                source_type,
                source_id,
                source_line_id,
                item_id
            )
            WHERE source_type = 'SALE'
              AND source_id IS NOT NULL
              AND source_line_id IS NOT NULL
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS stock_adjustments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                adjustment_code TEXT NOT NULL UNIQUE,
                adjustment_time TEXT NOT NULL,
                reason TEXT,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS stock_adjustment_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_adjustment_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,
                system_quantity REAL NOT NULL,
                actual_quantity REAL NOT NULL,
                quantity_delta REAL NOT NULL,
                note TEXT,
                FOREIGN KEY (stock_adjustment_id)
                    REFERENCES stock_adjustments(id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES items(id),
                UNIQUE (stock_adjustment_id, item_id)
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_stock_adjustment_items_item
            ON stock_adjustment_items (item_id, stock_adjustment_id)
            """
        )

        legacy_items_without_conversions = connection.execute(
            """
            SELECT id, smallest_unit_id
            FROM items
            WHERE NOT EXISTS (
                SELECT 1
                FROM item_unit_conversions AS c
                WHERE c.item_id = items.id
            )
            """
        ).fetchall()

        for item in legacy_items_without_conversions:
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
                (item["id"], item["smallest_unit_id"]),
            )

        connection.commit()
