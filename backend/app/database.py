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
