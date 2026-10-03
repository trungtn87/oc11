import sqlite3

from fastapi.testclient import TestClient

from backend.app.backup import backup_database
from backend.app.main import app


def test_backup_creates_latest_and_daily_files(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    db_path = data_dir / "oc11.db"
    backup_dir = tmp_path / "drive" / "OC11_Backup"

    monkeypatch.setenv("OC11_DATA_DIR", str(data_dir))
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    data_dir.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.execute("CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT)")
        connection.execute("INSERT INTO demo (value) VALUES ('ok')")
        connection.commit()

    settings_path = data_dir / "settings.json"
    settings_path.write_text(
        (
            "{"
            "\"backup_enabled\": true,"
            f"\"backup_folder\": {str(backup_dir)!r},"
            "\"google_drive_configured\": true"
            "}"
        ).replace("'", '"'),
        encoding="utf-8",
    )

    result = backup_database()

    assert result["last_error"] is None
    assert (backup_dir / "oc11_latest.db").exists()
    assert len(list(backup_dir.glob("oc11_????-??-??.db"))) == 1

    with sqlite3.connect(backup_dir / "oc11_latest.db") as connection:
        assert connection.execute("SELECT value FROM demo").fetchone()[0] == "ok"


def test_item_group_write_triggers_backup(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    db_path = data_dir / "oc11.db"
    backup_dir = tmp_path / "backup"

    monkeypatch.setenv("OC11_DATA_DIR", str(data_dir))
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "settings.json").write_text(
        (
            "{"
            "\"backup_enabled\": true,"
            f"\"backup_folder\": {str(backup_dir)!r},"
            "\"google_drive_configured\": false"
            "}"
        ).replace("'", '"'),
        encoding="utf-8",
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/item-groups",
            json={
                "name": "Hải sản",
                "note": None,
                "is_active": True,
            },
        )

    assert response.status_code == 201
    assert (backup_dir / "oc11_latest.db").exists()
