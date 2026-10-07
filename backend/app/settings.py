import json
import os
import sys
from pathlib import Path
from threading import Lock

_settings_lock = Lock()


def get_data_dir() -> Path:
    configured = os.getenv("OC11_DATA_DIR")
    if configured:
        path = Path(configured)
    elif getattr(sys, "frozen", False):
        root = Path(
            os.getenv("OC11_PORTABLE_ROOT", str(Path(sys.executable).resolve().parent))
        )
        path = root / "data"
    else:
        path = Path(__file__).resolve().parents[1] / "data"

    path.mkdir(parents=True, exist_ok=True)
    return path


def get_settings_path() -> Path:
    return get_data_dir() / "settings.json"


def default_backup_folder() -> Path:
    path = get_data_dir() / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def default_settings() -> dict:
    return {
        "backup_enabled": True,
        "backup_folder": str(default_backup_folder()),
        "google_drive_configured": False,
        "kitchen_printer_name": "",
    }


def load_settings() -> dict:
    path = get_settings_path()

    with _settings_lock:
        if not path.exists():
            settings = default_settings()
            path.write_text(
                json.dumps(settings, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            return settings

        try:
            saved = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            saved = {}

        settings = default_settings()
        settings.update(saved)
        return settings


def save_settings(settings: dict) -> dict:
    path = get_settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    with _settings_lock:
        temp = path.with_suffix(".tmp")
        temp.write_text(
            json.dumps(settings, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temp, path)

    return settings
