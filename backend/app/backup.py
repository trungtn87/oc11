import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from threading import Lock

from .database import get_db_path
from .settings import load_settings

_backup_lock = Lock()
_last_error: str | None = None
_last_backup: str | None = None


def _snapshot_database(destination: Path) -> None:
    source_path = get_db_path()
    destination.parent.mkdir(parents=True, exist_ok=True)

    temp_path = destination.with_suffix(destination.suffix + ".tmp")
    if temp_path.exists():
        temp_path.unlink()

    source = sqlite3.connect(source_path)
    target = sqlite3.connect(temp_path)

    try:
        source.backup(target)
    finally:
        target.close()
        source.close()

    os.replace(temp_path, destination)


def backup_database(reason: str = "manual") -> dict:
    global _last_error, _last_backup

    settings = load_settings()

    if not settings.get("backup_enabled", True):
        return get_backup_status()

    folder = Path(settings["backup_folder"])
    folder.mkdir(parents=True, exist_ok=True)

    now = datetime.now()
    latest = folder / "oc11_latest.db"
    daily = folder / f"oc11_{now:%Y-%m-%d}.db"

    with _backup_lock:
        try:
            _snapshot_database(latest)
            shutil.copy2(latest, daily)
            _last_backup = now.isoformat(timespec="seconds")
            _last_error = None
        except Exception as exc:  # Backup errors must never break business writes.
            _last_error = str(exc)

    return get_backup_status(reason=reason)


def get_backup_status(reason: str | None = None) -> dict:
    settings = load_settings()
    folder = Path(settings["backup_folder"])

    latest_file = folder / "oc11_latest.db"
    latest_modified = None
    if latest_file.exists():
        latest_modified = datetime.fromtimestamp(
            latest_file.stat().st_mtime
        ).isoformat(timespec="seconds")

    daily_count = 0
    if folder.exists():
        daily_count = len(
            [
                path
                for path in folder.glob("oc11_????-??-??.db")
                if path.is_file()
            ]
        )

    return {
        "enabled": bool(settings.get("backup_enabled", True)),
        "folder": str(folder),
        "google_drive_configured": bool(
            settings.get("google_drive_configured", False)
        ),
        "latest_backup": _last_backup or latest_modified,
        "latest_file_exists": latest_file.exists(),
        "daily_backup_count": daily_count,
        "last_error": _last_error,
        "reason": reason,
    }
