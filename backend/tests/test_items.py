import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import app


def create_group(client: TestClient, name: str = "Hải sản"):
    return client.post(
        "/api/item-groups",
        json={"name": name, "note": None, "is_active": True},
    ).json()


def create_unit(client: TestClient, name: str):
    return client.post(
        "/api/units",
        json={"name": name, "is_active": True},
    ).json()


def item_payload(
    group_id: int,
    default_unit_id: int,
    smallest_unit_id: int,
    name: str = "Ốc hương",
    conversions=None,
    **overrides,
):
    return {
        "name": name,
        "item_group_id": group_id,
        "default_unit_id": default_unit_id,
        "smallest_unit_id": smallest_unit_id,
        "note": overrides.get("note"),
        "is_active": overrides.get("is_active", True),
        "conversions": conversions or [],
    }


def test_create_item_with_default_and_smallest_unit(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        kg = create_unit(client, "kg")
        gram = create_unit(client, "g")

        created = client.post(
            "/api/items",
            json=item_payload(
                group["id"],
                kg["id"],
                gram["id"],
                conversions=[
                    {
                        "unit_id": kg["id"],
                        "quantity_in_smallest_unit": 1000,
                        "is_active": True,
                    }
                ],
            ),
        )

        assert created.status_code == 201
        body = created.json()
        assert body["name"] == "Ốc hương"
        assert body["default_unit_name"] == "kg"
        assert body["smallest_unit_name"] == "g"

        factors = {
            row["unit_name"]: row["quantity_in_smallest_unit"]
            for row in body["conversions"]
        }
        assert factors == {"kg": 1000.0, "g": 1.0}


def test_same_default_and_smallest_unit_gets_factor_one(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client, "Đồ uống")
        lon = create_unit(client, "lon")

        created = client.post(
            "/api/items",
            json=item_payload(
                group["id"],
                lon["id"],
                lon["id"],
                name="Bia lon",
            ),
        )

        assert created.status_code == 201
        conversions = created.json()["conversions"]
        assert len(conversions) == 1
        assert conversions[0]["unit_name"] == "lon"
        assert conversions[0]["quantity_in_smallest_unit"] == 1


def test_multiple_item_specific_conversions(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client, "Đồ uống")
        thung = create_unit(client, "thùng")
        loc = create_unit(client, "lốc")
        lon = create_unit(client, "lon")

        created = client.post(
            "/api/items",
            json=item_payload(
                group["id"],
                thung["id"],
                lon["id"],
                name="Bia Tiger",
                conversions=[
                    {
                        "unit_id": thung["id"],
                        "quantity_in_smallest_unit": 24,
                        "is_active": True,
                    },
                    {
                        "unit_id": loc["id"],
                        "quantity_in_smallest_unit": 6,
                        "is_active": True,
                    },
                ],
            ),
        )

        assert created.status_code == 201
        factors = {
            row["unit_name"]: row["quantity_in_smallest_unit"]
            for row in created.json()["conversions"]
        }
        assert factors == {"thùng": 24.0, "lốc": 6.0, "lon": 1.0}


def test_default_unit_requires_conversion_when_different(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        kg = create_unit(client, "kg")
        gram = create_unit(client, "g")

        response = client.post(
            "/api/items",
            json=item_payload(group["id"], kg["id"], gram["id"]),
        )

        assert response.status_code == 422


def test_smallest_unit_factor_must_equal_one(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        kg = create_unit(client, "kg")
        gram = create_unit(client, "g")

        response = client.post(
            "/api/items",
            json=item_payload(
                group["id"],
                kg["id"],
                gram["id"],
                conversions=[
                    {
                        "unit_id": kg["id"],
                        "quantity_in_smallest_unit": 1000,
                        "is_active": True,
                    },
                    {
                        "unit_id": gram["id"],
                        "quantity_in_smallest_unit": 2,
                        "is_active": True,
                    },
                ],
            ),
        )

        assert response.status_code == 422


def test_duplicate_conversion_unit_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        kg = create_unit(client, "kg")
        gram = create_unit(client, "g")

        response = client.post(
            "/api/items",
            json=item_payload(
                group["id"],
                kg["id"],
                gram["id"],
                conversions=[
                    {
                        "unit_id": kg["id"],
                        "quantity_in_smallest_unit": 1000,
                        "is_active": True,
                    },
                    {
                        "unit_id": kg["id"],
                        "quantity_in_smallest_unit": 500,
                        "is_active": True,
                    },
                ],
            ),
        )

        assert response.status_code == 422


def test_item_name_is_unique_case_insensitive(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        kg = create_unit(client, "kg")

        first = client.post(
            "/api/items",
            json=item_payload(group["id"], kg["id"], kg["id"], name="Ngao"),
        )
        duplicate = client.post(
            "/api/items",
            json=item_payload(group["id"], kg["id"], kg["id"], name="NGAO"),
        )

        assert first.status_code == 201
        assert duplicate.status_code == 409


def test_update_item_and_conversions(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client, "Đồ uống")
        thung = create_unit(client, "thùng")
        loc = create_unit(client, "lốc")
        lon = create_unit(client, "lon")

        created = client.post(
            "/api/items",
            json=item_payload(
                group["id"],
                thung["id"],
                lon["id"],
                name="Bia Tiger",
                conversions=[
                    {
                        "unit_id": thung["id"],
                        "quantity_in_smallest_unit": 24,
                        "is_active": True,
                    }
                ],
            ),
        ).json()

        updated = client.put(
            f"/api/items/{created['id']}",
            json=item_payload(
                group["id"],
                thung["id"],
                lon["id"],
                name="Bia Tiger",
                is_active=False,
                conversions=[
                    {
                        "unit_id": thung["id"],
                        "quantity_in_smallest_unit": 24,
                        "is_active": True,
                    },
                    {
                        "unit_id": loc["id"],
                        "quantity_in_smallest_unit": 6,
                        "is_active": True,
                    },
                ],
            ),
        )

        assert updated.status_code == 200
        assert updated.json()["is_active"] is False
        assert len(updated.json()["conversions"]) == 3


def test_delete_item_is_not_supported(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        group = create_group(client)
        kg = create_unit(client, "kg")
        created = client.post(
            "/api/items",
            json=item_payload(group["id"], kg["id"], kg["id"]),
        ).json()

        response = client.delete(f"/api/items/{created['id']}")
        assert response.status_code == 405


def test_legacy_item_schema_is_migrated(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE item_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                note TEXT,
                is_active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE units (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                is_active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                item_type TEXT NOT NULL,
                item_group_id INTEGER NOT NULL,
                unit_id INTEGER NOT NULL,
                note TEXT,
                is_active INTEGER NOT NULL DEFAULT 1
            );
            INSERT INTO item_groups (id, name, is_active) VALUES (1, 'Hải sản', 1);
            INSERT INTO units (id, name, is_active) VALUES (1, 'kg', 1);
            INSERT INTO items (
                id, name, item_type, item_group_id, unit_id, is_active
            ) VALUES (1, 'Ốc hương', 'material', 1, 1, 1);
            """
        )

    with TestClient(app) as client:
        listed = client.get("/api/items")

        assert listed.status_code == 200
        body = listed.json()[0]
        assert body["default_unit_name"] == "kg"
        assert body["smallest_unit_name"] == "kg"
        assert body["conversions"][0]["quantity_in_smallest_unit"] == 1



def test_smallest_unit_is_locked_after_inventory_movement(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        group = create_group(client, "Đồ uống")
        thung = create_unit(client, "thùng")
        lon = create_unit(client, "lon")

        created = client.post(
            "/api/items",
            json=item_payload(
                group["id"],
                thung["id"],
                lon["id"],
                name="Bia Hà Nội",
                conversions=[
                    {
                        "unit_id": thung["id"],
                        "quantity_in_smallest_unit": 24,
                        "is_active": True,
                    }
                ],
            ),
        ).json()

        with sqlite3.connect(db_path) as connection:
            connection.execute(
                """
                INSERT INTO inventory_movements (
                    item_id,
                    movement_time,
                    quantity_delta,
                    source_type,
                    source_id,
                    source_line_id,
                    note
                )
                VALUES (?, '2026-10-05T08:00', 24, 'PURCHASE_RECEIPT', '1', '1', 'test')
                """,
                (created["id"],),
            )
            connection.commit()

        response = client.put(
            f"/api/items/{created['id']}",
            json=item_payload(
                group["id"],
                thung["id"],
                thung["id"],
                name="Bia Hà Nội",
                conversions=[],
            ),
        )

        assert response.status_code == 409
        assert "đơn vị nhỏ nhất" in response.json()["detail"].lower()


def test_sale_inventory_source_line_is_unique(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        group = create_group(client, "Đồ uống")
        lon = create_unit(client, "lon")
        created = client.post(
            "/api/items",
            json=item_payload(
                group["id"],
                lon["id"],
                lon["id"],
                name="Nước ngọt",
            ),
        ).json()

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO inventory_movements (
                item_id,
                movement_time,
                quantity_delta,
                source_type,
                source_id,
                source_line_id,
                note
            )
            VALUES (?, '2026-10-05T20:00', -1, 'SALE', 'HD000001', 'LINE-1', 'Bán hàng')
            """,
            (created["id"],),
        )
        connection.commit()

        try:
            connection.execute(
                """
                INSERT INTO inventory_movements (
                    item_id,
                    movement_time,
                    quantity_delta,
                    source_type,
                    source_id,
                    source_line_id,
                    note
                )
                VALUES (?, '2026-10-05T20:01', -1, 'SALE', 'HD000001', 'LINE-1', 'Bán hàng')
                """,
                (created["id"],),
            )
            connection.commit()
            duplicated = True
        except sqlite3.IntegrityError:
            duplicated = False

    assert duplicated is False


def test_stock_adjustment_tables_are_initialized(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                """
            ).fetchall()
        }

    assert "stock_adjustments" in tables
    assert "stock_adjustment_items" in tables
