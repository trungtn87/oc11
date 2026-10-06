import argparse
import csv
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


APP_BIND_HOST = "0.0.0.0"
APP_LOCAL_HOST = "127.0.0.1"
APP_PORT = 8000
APP_URL = f"http://{APP_LOCAL_HOST}:{APP_PORT}"
STARTUP_VALUE_NAME = "OC11"


# PyInstaller --windowed sets stdout/stderr to None on Windows.
# Some dependencies still expect file-like streams during startup.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")


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


def executable_path() -> Path:
    if is_frozen():
        return Path(sys.executable).resolve()
    return Path(__file__).resolve()


def build_version() -> str:
    try:
        return str(executable_path().stat().st_mtime_ns)
    except OSError:
        return str(int(time.time()))


def windows_creation_flags() -> int:
    return int(getattr(subprocess, "CREATE_NO_WINDOW", 0))


def register_windows_startup() -> None:
    if (
        os.name != "nt"
        or not is_frozen()
        or os.getenv("OC11_NO_STARTUP_REGISTER") == "1"
    ):
        return

    try:
        import winreg

        command = f'"{executable_path()}" --startup'
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE,
        ) as key:
            winreg.SetValueEx(
                key,
                STARTUP_VALUE_NAME,
                0,
                winreg.REG_SZ,
                command,
            )
    except OSError:
        # Startup registration must never block the application itself.
        pass


def notify_error(message: str) -> None:
    if os.name == "nt":
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(
                0,
                message,
                "Ốc 11",
                0x10,
            )
            return
        except Exception:
            pass
    print(message, file=sys.stderr)


def probe_runtime(timeout: float = 0.6) -> dict | None:
    try:
        with urllib.request.urlopen(
            f"{APP_URL}/api/runtime",
            timeout=timeout,
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("app") == "OC11":
            return payload
    except (OSError, ValueError, urllib.error.URLError):
        return None
    return None


def server_is_healthy(timeout: float = 0.6) -> bool:
    try:
        with urllib.request.urlopen(
            f"{APP_URL}/api/health",
            timeout=timeout,
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload.get("status") == "ok"
    except (OSError, ValueError, urllib.error.URLError):
        return False


def normalize_path(value: str | Path) -> str:
    return os.path.normcase(os.path.abspath(os.fspath(value)))


def listener_pid(port: int) -> int | None:
    if os.name != "nt":
        return None

    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            check=False,
            capture_output=True,
            text=True,
            creationflags=windows_creation_flags(),
        )
    except OSError:
        return None

    suffix = f":{port}"
    for raw_line in result.stdout.splitlines():
        parts = raw_line.split()
        if len(parts) < 4 or parts[0].upper() != "TCP":
            continue
        local_address = parts[1]
        pid_text = parts[-1]
        if local_address.endswith(suffix) and pid_text.isdigit():
            pid = int(pid_text)
            if pid != os.getpid():
                return pid
    return None


def process_image_name(pid: int) -> str | None:
    if os.name != "nt":
        return None

    try:
        result = subprocess.run(
            [
                "tasklist",
                "/FI",
                f"PID eq {pid}",
                "/FO",
                "CSV",
                "/NH",
            ],
            check=False,
            capture_output=True,
            text=True,
            creationflags=windows_creation_flags(),
        )
        rows = list(csv.reader(result.stdout.splitlines()))
        if not rows or len(rows[0]) < 2:
            return None
        if rows[0][1].strip() != str(pid):
            return None
        return rows[0][0].strip()
    except OSError:
        return None


def terminate_process(pid: int) -> bool:
    if os.name != "nt":
        return False

    try:
        result = subprocess.run(
            ["taskkill", "/PID", str(pid), "/F"],
            check=False,
            capture_output=True,
            text=True,
            creationflags=windows_creation_flags(),
        )
        return result.returncode == 0
    except OSError:
        return False


def wait_for_port_release(timeout: float = 8.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if listener_pid(APP_PORT) is None and not server_is_healthy(0.25):
            return True
        time.sleep(0.2)
    return listener_pid(APP_PORT) is None


def open_manager() -> None:
    webbrowser.open(f"{APP_URL}/?v={build_version()}")


def open_manager_when_ready() -> None:
    for _ in range(60):
        if server_is_healthy(0.5):
            open_manager()
            return
        time.sleep(0.25)


def handle_existing_instance(started_from_windows: bool) -> bool:
    """
    Return True when this launcher should exit because an existing OC11 instance
    is already serving the app. A different/older portable copy is stopped so
    the current executable can take over port 8000.
    """
    runtime = probe_runtime()
    current_executable = normalize_path(executable_path())

    if runtime is not None:
        old_pid = int(runtime.get("pid") or 0)
        old_executable = str(runtime.get("executable") or "")
        old_build = str(runtime.get("build_version") or "")
        current_build = build_version()
        same_path = (
            bool(old_executable)
            and normalize_path(old_executable) == current_executable
        )
        same_build = bool(old_build) and old_build == current_build

        # Important for in-place updates:
        # Windows can keep the old OC11 process alive even after OC11.exe
        # has been replaced on disk. The path is therefore not enough to
        # identify the running version; compare the build fingerprint too.
        if same_path and same_build:
            if not started_from_windows and os.getenv("OC11_NO_BROWSER") != "1":
                open_manager()
            return True

        if old_pid > 0 and terminate_process(old_pid):
            if wait_for_port_release():
                return False

        notify_error(
            "Ốc 11 đang chạy nhưng không thể chuyển sang bản mới. "
            "Hãy thử chạy lại OC11.exe."
        )
        return True

    pid = listener_pid(APP_PORT)
    if pid is None:
        return False

    image_name = process_image_name(pid)
    if image_name and image_name.casefold() == "oc11.exe":
        # Compatibility with older OC11 builds that did not expose /api/runtime.
        if terminate_process(pid) and wait_for_port_release():
            return False

        notify_error(
            "Không thể đóng bản OC11 cũ đang chạy. "
            "Hãy thử chạy lại OC11.exe."
        )
        return True

    notify_error(
        "Cổng 8000 đang được một ứng dụng khác sử dụng. "
        "Ốc 11 không tự đóng ứng dụng đó."
    )
    return True


root = portable_root()
static_dir = (
    resource_root() / "static"
    if is_frozen()
    else root / "manager-web" / "dist"
)

os.environ.setdefault("OC11_PORTABLE_ROOT", str(root))
os.environ.setdefault("OC11_STATIC_DIR", str(static_dir))
os.environ["OC11_EXECUTABLE"] = str(executable_path())
os.environ["OC11_BUILD_VERSION"] = build_version()
os.environ["OC11_RUNTIME_TOKEN"] = secrets.token_urlsafe(24)

from backend.app.main import app  # noqa: E402
import uvicorn  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--startup", action="store_true")
    args, _ = parser.parse_known_args()

    (root / "data").mkdir(parents=True, exist_ok=True)

    register_windows_startup()

    if handle_existing_instance(started_from_windows=args.startup):
        return

    if not args.startup and os.getenv("OC11_NO_BROWSER") != "1":
        threading.Thread(
            target=open_manager_when_ready,
            name="oc11-browser",
            daemon=True,
        ).start()

    uvicorn.run(
        app,
        host=APP_BIND_HOST,
        port=APP_PORT,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
