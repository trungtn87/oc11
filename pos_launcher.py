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


def probe_runtime(timeout: float = 0.5) -> dict | None:
    """Read the identity of the *running* backend, not merely its health."""
    try:
        with urllib.request.urlopen(APP_URL + "/api/runtime", timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload if payload.get("app") == "OC11" else None
    except (OSError, ValueError, urllib.error.URLError):
        return None


def running_backend_is_paired(server_exe: Path, runtime: dict | None = None) -> bool:
    """Never attach POS to an old backend just because it answers /api/runtime.

    OC11.exe uses its own mtime_ns as build_version. Both executable path
    AND fingerprint must match: updating an EXE in place keeps its path.
    """
    if runtime is None:
        runtime = probe_runtime()
    if not runtime:
        return False
    try:
        executable = str(runtime.get("executable") or "")
        current = os.path.normcase(os.path.abspath(str(server_exe)))
        running = os.path.normcase(os.path.abspath(executable)) if executable else ""
        return (
            bool(executable)
            and running == current
            and str(runtime.get("build_version") or "") == str(server_exe.stat().st_mtime_ns)
        )
    except OSError:
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
    server_exe = root_dir() / "OC11.exe"
    if not server_exe.is_file():
        notify_error(
            "Không tìm thấy OC11.exe cùng phiên bản. "
            "Hãy giải nén cả OC11.exe và OC11-POS.exe vào cùng một thư mục."
        )
        return False

    if running_backend_is_paired(server_exe):
        return True

    # Always invoke the *paired* OC11.exe when the running backend is stale.
    # The main launcher safely stops an older OC11 on port 8000 and starts
    # this version, without touching data/oc11.db.
    try:
        subprocess.Popen(
            [str(server_exe), "--startup"],
            cwd=str(root_dir()),
            creationflags=windows_creation_flags(),
        )
    except OSError as exc:
        notify_error(f"Không khởi động được OC11.exe: {exc}")
        return False

    for _ in range(100):
        if running_backend_is_paired(server_exe):
            return True
        time.sleep(0.25)

    notify_error(
        "POS không kết nối được với backend đúng phiên bản. "
        "Hãy kiểm tra OC11.exe đang chạy và thử khởi động lại."
    )
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
