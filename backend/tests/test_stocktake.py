import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import app


def create_item(client, name):
    group = client.post(
        "/api/item-groups",
        json={"name": f"Nhóm {name}", "is_active": True},
    ).json()
    unit = client.post(
        "/api/units",
        json={"name": f"kg-{name}", "is_active": True},
    ).json()
    response = client.post(
        "/api/items",
        json={
            "name": name,
            "item_group_id": group["id"],
            "default_unit_id": unit["id"],
            "smallest_unit_id": unit["id"],
            "is_active": True,
            "conversions": [],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def row_for(client, item_id):
    response = client.get("/api/inventory/stock")
    assert response.status_code == 200
    return next(row for row in response.json() if row["item_id"] == item_id)


def line(client, item_id, actual):
    snapshot = row_for(client, item_id)
    return {
        "item_id": item_id,
        "expected_quantity": snapshot["stock_quantity"],
        "expected_revision": snapshot["stock_revision"],
        "actual_quantity": actual,
    }


def batch(sync_id, rows):
    return {
        "client_sync_id": sync_id,
        "reason": "Kiểm kho",
        "items": rows,
    }


def test_tracking_toggle_is_independent_and_legacy_put_preserves_flag(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))
    with TestClient(app) as client:
        item = create_item(client, "Ốc hương")
        assert item["is_stock_tracked"] is True
        response = client.patch(
            f"/api/items/{item['id']}/stock-tracking",
            json={"is_stock_tracked": False},
        )
        assert response.status_code == 200
        assert response.json()["is_stock_tracked"] is False
        assert response.json()["is_active"] is True
        assert row_for(client, item["id"])["is_stock_tracked"] is False
        assert client.get(
            "/api/inventory/stock", params={"tracking": "TRACKED"}
        ).json() == []
        assert len(client.get(
            "/api/inventory/stock", params={"tracking": "UNTRACKED"}
        ).json()) == 1

        # Older Android / manager clients do not send the new field.
        old_client_update = client.put(
            f"/api/items/{item['id']}",
            json={
                "name": item["name"],
                "item_group_id": item["item_group_id"],
                "default_unit_id": item["default_unit_id"],
                "smallest_unit_id": item["smallest_unit_id"],
                "is_active": False,
                "conversions": [],
            },
        )
        assert old_client_update.status_code == 200
        assert old_client_update.json()["is_active"] is False
        assert old_client_update.json()["is_stock_tracked"] is False

        resumed = client.patch(
            f"/api/items/{item['id']}/stock-tracking",
            json={"is_stock_tracked": True},
        )
        assert resumed.status_code == 200
        assert resumed.json()["is_stock_tracked"] is True
        assert resumed.json()["is_active"] is False


def test_atomic_batch_updates_multiple_items_and_sorts_lowest_first(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        a = create_item(client, "Mực")
        b = create_item(client, "Ngao")
        request = batch(
            "offline-test-1001",
            [line(client, a["id"], 5), line(client, b["id"], 2)],
        )
        response = client.post("/api/inventory/adjustments/batch", json=request)
        assert response.status_code == 201, response.text
        data = response.json()
        assert data["already_synced"] is False
        assert len(data["items"]) == 2
        assert [x["quantity_delta"] for x in data["items"]] == [5, 2]

        stock = client.get("/api/inventory/stock").json()
        assert [x["item_name"] for x in stock] == ["Ngao", "Mực"]
        assert [x["stock_quantity"] for x in stock] == [2, 5]
        assert all(x["stock_revision"] > 0 for x in stock)
        with sqlite3.connect(db_path) as db:
            assert db.execute("SELECT COUNT(*) FROM stock_adjustments").fetchone()[0] == 1
            assert db.execute("SELECT COUNT(*) FROM stock_adjustment_items").fetchone()[0] == 2
            assert db.execute(
                "SELECT COUNT(*) FROM inventory_movements WHERE source_type = 'STOCK_ADJUSTMENT'"
            ).fetchone()[0] == 2


def test_upload_retry_is_idempotent_and_changed_reuse_is_rejected(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        item = create_item(client, "Bia lon")
        request = batch("offline-test-1002", [line(client, item["id"], 12)])
        first = client.post("/api/inventory/adjustments/batch", json=request)
        retry = client.post("/api/inventory/adjustments/batch", json=request)
        assert first.status_code == retry.status_code == 201
        assert retry.json()["already_synced"] is True
        assert first.json()["id"] == retry.json()["id"]
        assert row_for(client, item["id"])["stock_quantity"] == 12

        altered = batch("offline-test-1002", [line(client, item["id"], 13)])
        rejected = client.post("/api/inventory/adjustments/batch", json=altered)
        assert rejected.status_code == 409
        assert rejected.json()["detail"]["code"] == "SYNC_ID_REUSED"
        with sqlite3.connect(db_path) as db:
            assert db.execute("SELECT COUNT(*) FROM stock_adjustments").fetchone()[0] == 1
            assert db.execute("SELECT COUNT(*) FROM inventory_movements").fetchone()[0] == 1


def test_stale_offline_snapshot_rejects_entire_batch(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        a = create_item(client, "Tôm")
        b = create_item(client, "Cua")
        request = batch(
            "offline-test-1003",
            [line(client, a["id"], 4), line(client, b["id"], 8)],
        )
        # A new sale or purchase was recorded after the phone cached stock.
        with sqlite3.connect(db_path) as db:
            db.execute(
                """
                INSERT INTO inventory_movements (
                    item_id, movement_time, quantity_delta,
                    source_type, source_id
                ) VALUES (?, '2000-01-01T00:00:00', 3, 'PURCHASE_RECEIPT', '1')
                """,
                (b["id"],),
            )

        response = client.post("/api/inventory/adjustments/batch", json=request)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "STOCK_CHANGED"
        assert response.json()["detail"]["items"][0]["item_id"] == b["id"]
        assert row_for(client, a["id"])["stock_quantity"] == 0
        assert row_for(client, b["id"])["stock_quantity"] == 3
        with sqlite3.connect(db_path) as db:
            assert db.execute("SELECT COUNT(*) FROM stock_adjustments").fetchone()[0] == 0

        # Rebase on the newer stock snapshot, with a new client sync ID.
        new_request = batch(
            "offline-test-1004",
            [line(client, a["id"], 4), line(client, b["id"], 8)],
        )
        accepted = client.post(
            "/api/inventory/adjustments/batch", json=new_request
        )
        assert accepted.status_code == 201
        assert row_for(client, b["id"])["stock_quantity"] == 8


def test_untracked_and_duplicate_lines_are_not_written(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    with TestClient(app) as client:
        item = create_item(client, "Sò lông")
        original = line(client, item["id"], 7)
        assert client.patch(
            f"/api/items/{item['id']}/stock-tracking",
            json={"is_stock_tracked": False},
        ).status_code == 200

        untracked = client.post(
            "/api/inventory/adjustments/batch",
            json=batch("offline-test-1005", [original]),
        )
        assert untracked.status_code == 409
        assert untracked.json()["detail"]["code"] == "STOCK_CHANGED"
        assert untracked.json()["detail"]["items"][0]["is_stock_tracked"] is False

        duplicate = client.post(
            "/api/inventory/adjustments/batch",
            json=batch("offline-test-1006", [original, original]),
        )
        assert duplicate.status_code == 422
        with sqlite3.connect(db_path) as db:
            assert db.execute("SELECT COUNT(*) FROM stock_adjustments").fetchone()[0] == 0
