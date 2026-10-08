"""POS must not serve an old Order UI from a stale OC11 backend."""
from pathlib import Path

import pos_launcher


def test_running_backend_must_match_both_binary_and_build(tmp_path, monkeypatch):
    server = tmp_path / "OC11.exe"
    server.write_bytes(b"new build")
    current = {
        "app": "OC11",
        "executable": str(server.resolve()),
        "build_version": str(server.stat().st_mtime_ns),
    }
    assert pos_launcher.running_backend_is_paired(server, current)
    assert not pos_launcher.running_backend_is_paired(
        server, {**current, "build_version": "old build"}
    )
    assert not pos_launcher.running_backend_is_paired(
        server, {**current, "executable": str(tmp_path / "old" / "OC11.exe")}
    )
    assert not pos_launcher.running_backend_is_paired(server, {})


def test_pos_launches_paired_backend_when_old_version_is_running(tmp_path, monkeypatch):
    exe = tmp_path / "OC11.exe"
    exe.write_bytes(b"new build")
    old = {
        "app": "OC11",
        "executable": str(exe.resolve()),
        "build_version": "outdated-fingerprint",
    }
    new = {**old, "build_version": str(exe.stat().st_mtime_ns)}
    runtime = [old, old, new]
    started = []
    failures = []
    monkeypatch.setattr(pos_launcher, "root_dir", lambda: tmp_path)
    monkeypatch.setattr(pos_launcher, "probe_runtime",
                        lambda: runtime.pop(0) if runtime else new)
    monkeypatch.setattr(pos_launcher.subprocess, "Popen",
                        lambda args, **kw: started.append((args, kw)))
    monkeypatch.setattr(pos_launcher.time, "sleep", lambda _: None)
    monkeypatch.setattr(pos_launcher, "notify_error", failures.append)

    assert pos_launcher.ensure_server() is True
    assert len(started) == 1
    assert started[0][0] == [str(exe), "--startup"]
    assert not failures


def test_pos_does_not_spawn_backend_when_current_version_is_running(
    tmp_path, monkeypatch
):
    exe = tmp_path / "OC11.exe"
    exe.write_bytes(b"current build")
    runtime = {
        "app": "OC11",
        "executable": str(exe.resolve()),
        "build_version": str(exe.stat().st_mtime_ns),
    }
    monkeypatch.setattr(pos_launcher, "root_dir", lambda: tmp_path)
    monkeypatch.setattr(pos_launcher, "probe_runtime", lambda: runtime)
    monkeypatch.setattr(pos_launcher.subprocess, "Popen",
                        lambda *_, **__: (_ for _ in ()).throw(
                            AssertionError("duplicate backend launch")))
    assert pos_launcher.ensure_server() is True


def test_pos_requires_paired_backend_executable(tmp_path, monkeypatch):
    errors = []
    monkeypatch.setattr(pos_launcher, "root_dir", lambda: tmp_path)
    monkeypatch.setattr(pos_launcher, "notify_error", errors.append)
    assert pos_launcher.ensure_server() is False
    assert "OC11.exe" in errors[0]
