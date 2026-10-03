import os
import sys
import threading
import webbrowser
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def portable_root() -> Path:
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def resource_root() -> Path:
    if is_frozen() and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


root = portable_root()
static_dir = (
    resource_root() / "static"
    if is_frozen()
    else root / "manager-web" / "dist"
)

os.environ.setdefault("OC11_PORTABLE_ROOT", str(root))
os.environ.setdefault("OC11_STATIC_DIR", str(static_dir))

from backend.app.main import app  # noqa: E402
import uvicorn  # noqa: E402


def open_manager() -> None:
    webbrowser.open("http://127.0.0.1:8000")


if __name__ == "__main__":
    (root / "data").mkdir(parents=True, exist_ok=True)

    if os.getenv("OC11_NO_BROWSER") != "1":
        threading.Timer(1.5, open_manager).start()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="warning",
    )
