import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


APP_URL = "http://127.0.0.1:8000"
POS_URL = APP_URL + "/?mode=pos"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def root_dir() -> Path:
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def windows_creation_flags() -> int:
    return int(getattr(subprocess, "CREATE_NO_WINDOW", 0))


def runtime_is_oc11(timeout: float = 0.5) -> bool:
    try:
        with urllib.request.urlopen(APP_URL + "/api/runtime", timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload.get("app") == "OC11"
    except (OSError, ValueError, urllib.error.URLError):
        return False


def notify_error(message: str) -> None:
    if os.name == "nt":
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, message, "Ốc 11 POS", 0x10)
            return
        except Exception:
            pass
    print(message, file=sys.stderr)


def ensure_server() -> bool:
    if runtime_is_oc11():
        return True

    server_exe = root_dir() / "OC11.exe"
    if not server_exe.exists():
        notify_error(
            "Không tìm thấy OC11.exe. Hãy để OC11-POS.exe cùng thư mục với OC11.exe."
        )
        return False

    try:
        subprocess.Popen(
            [str(server_exe), "--startup"],
            cwd=str(root_dir()),
            creationflags=windows_creation_flags(),
        )
    except OSError as exc:
        notify_error(f"Không khởi động được OC11.exe: {exc}")
        return False

    for _ in range(60):
        if runtime_is_oc11():
            return True
        time.sleep(0.25)

    notify_error("OC11 chưa khởi động được backend. Hãy chạy OC11.exe rồi thử lại POS.")
    return False


def find_edge() -> Path | None:
    roots = [
        os.environ.get("PROGRAMFILES(X86)", ""),
        os.environ.get("PROGRAMFILES", ""),
        os.environ.get("LOCALAPPDATA", ""),
    ]
    candidates = [
        Path(root) / "Microsoft/Edge/Application/msedge.exe"
        for root in roots
        if root
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def launch_pos() -> None:
    if os.getenv("OC11_POS_NO_LAUNCH") == "1":
        return

    edge = find_edge()
    if edge is not None:
        try:
            subprocess.Popen(
                [
                    str(edge),
                    f"--app={POS_URL}",
                    "--start-maximized",
                    "--disable-session-crashed-bubble",
                ],
                creationflags=windows_creation_flags(),
            )
            return
        except OSError:
            pass

    webbrowser.open(POS_URL)


def main() -> None:
    if ensure_server():
        launch_pos()


if __name__ == "__main__":
    main()
