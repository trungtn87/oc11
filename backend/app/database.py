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
        connection.commit()
