import os
import platform
from pathlib import Path

from fastapi import APIRouter, HTTPException

from .backup import backup_database, get_backup_status
from .settings import load_settings, save_settings

router = APIRouter(prefix="/api/backup", tags=["backup"])


@router.get("/status")
def backup_status() -> dict:
    return get_backup_status()


@router.post("/run")
def run_backup() -> dict:
    return backup_database(reason="manual")


@router.post("/select-folder")
def select_backup_folder() -> dict:
    if platform.system() != "Windows":
        raise HTTPException(
            status_code=501,
            detail="Chọn thư mục trực tiếp chỉ hỗ trợ trên Windows.",
        )

    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="Windows hiện không hỗ trợ hộp thoại chọn thư mục.",
        ) from exc

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    selected = filedialog.askdirectory(
        title="Chọn thư mục Google Drive để sao lưu OC11"
    )
    root.destroy()

    if not selected:
        return get_backup_status()

    folder = Path(selected).resolve() / "OC11_Backup"
    folder.mkdir(parents=True, exist_ok=True)

    settings = load_settings()
    settings["backup_folder"] = str(folder)
    settings["backup_enabled"] = True
    settings["google_drive_configured"] = True
    save_settings(settings)

    return backup_database(reason="folder-selected")


@router.post("/use-local-folder")
def use_local_backup_folder() -> dict:
    settings = load_settings()
    data_dir = Path(os.getenv("OC11_DATA_DIR", "")).resolve() if os.getenv("OC11_DATA_DIR") else None

    if data_dir is None:
        from .settings import get_data_dir

        data_dir = get_data_dir()

    folder = data_dir / "backups"
    folder.mkdir(parents=True, exist_ok=True)

    settings["backup_folder"] = str(folder)
    settings["backup_enabled"] = True
    settings["google_drive_configured"] = False
    save_settings(settings)

    return backup_database(reason="local-folder")
