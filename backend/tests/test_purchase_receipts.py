import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import app


def create_supplier(client: TestClient):
    response = client.post("/api/suppliers", json={"name": "Hải sản A"})
    assert response.status_code == 201
    return response.json()


def create_item(client: TestClient):
    group = client.post(
        "/api/item-groups",
        json={"name": "Hải sản", "note": None, "is_active": True},
    ).json()
    unit = client.post(
        "/api/units",
        json={"name": "kg", "is_active": True},
    ).json()
    response = client.post(
        "/api/items",
        json={
            "name": "Ốc hương",
            "item_group_id": group["id"],
            "default_unit_id": unit["id"],
            "smallest_unit_id": unit["id"],
            "note": None,
            "is_active": True,
            "conversions": [],
        },
    )
    assert response.status_code == 201
    return response.json(), unit


def create_cash_account(client: TestClient):
    response = client.post(
        "/api/fund-accounts",
        json={
            "name": "Quỹ chính",
            "type": "CASH",
            "is_active": True,
        },
    )
    assert response.status_code == 201
    account = response.json()

    opening = client.post(
        "/api/fund-transactions",
        json={
            "account_type": "CASH",
            "fund_account_id": account["id"],
            "direction": "IN",
            "transaction_type": "OPENING_BALANCE",
            "transaction_time": "2026-10-05T07:00",
            "amount": 1_000_000,
            "description": "Số dư đầu kỳ",
        },
    )
    assert opening.status_code == 201
    return account


def receipt_payload(
    supplier_id: int,
    item_id: int,
    unit_id: int,
    *,
    quantity: float,
    unit_price: int,
    shipping_fee: int = 0,
    payment_status: str = "DEBT",
    payment=None,
    replaces_receipt_id=None,
):
    return {
        "supplier_id": supplier_id,
        "receipt_time": "2026-10-05T08:00",
        "description": "Nhập hàng test",
        "shipping_fee": shipping_fee,
        "payment_status": payment_status,
        "payment": payment,
        "replaces_receipt_id": replaces_receipt_id,
        "items": [
            {
                "item_id": item_id,
                "unit_id": unit_id,
                "quantity": quantity,
                "unit_price": unit_price,
                "note": None,
            }
        ],
    }


def test_debt_receipt_can_be_edited_and_stock_is_replaced(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        supplier = create_supplier(client)
        item, unit = create_item(client)

        created = client.post(
            "/api/purchase-receipts",
            json=receipt_payload(
                supplier["id"],
                item["id"],
                unit["id"],
                quantity=10,
                unit_price=100_000,
            ),
        )
        assert created.status_code == 201
        receipt = created.json()

        updated = client.put(
            f"/api/purchase-receipts/{receipt['id']}",
            json=receipt_payload(
                supplier["id"],
                item["id"],
                unit["id"],
                quantity=12,
                unit_price=110_000,
                shipping_fee=50_000,
            ),
        )
        assert updated.status_code == 200
        body = updated.json()
        assert body["receipt_code"] == receipt["receipt_code"]
        assert body["goods_total"] == 1_320_000
        assert body["shipping_fee"] == 50_000
        assert body["total_amount"] == 1_370_000
        assert body["items"][0]["quantity"] == 12

    with sqlite3.connect(db_path) as connection:
        stock = connection.execute(
            """
            SELECT COALESCE(SUM(quantity_delta), 0)
            FROM inventory_movements
            WHERE item_id = ?
            """,
            (item["id"],),
        ).fetchone()[0]
        line_count = connection.execute(
            "SELECT COUNT(*) FROM purchase_receipt_items WHERE purchase_receipt_id = ?",
            (receipt["id"],),
        ).fetchone()[0]

    assert stock == 12
    assert line_count == 1


def test_paid_receipt_cannot_be_edited(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        supplier = create_supplier(client)
        item, unit = create_item(client)
        account = create_cash_account(client)

        payload = receipt_payload(
            supplier["id"],
            item["id"],
            unit["id"],
            quantity=2,
            unit_price=100_000,
            payment_status="PAID",
            payment={
                "account_type": "CASH",
                "fund_account_id": account["id"],
            },
        )
        created = client.post("/api/purchase-receipts", json=payload)
        assert created.status_code == 201

        update = client.put(
            f"/api/purchase-receipts/{created.json()['id']}",
            json={
                **payload,
                "payment_status": "DEBT",
                "payment": None,
            },
        )
        assert update.status_code == 409
        assert "Hủy để nhập lại" in update.json()["detail"]


def test_void_paid_receipt_reverses_money_and_stock_then_allows_reentry(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        supplier = create_supplier(client)
        item, unit = create_item(client)
        account = create_cash_account(client)

        created = client.post(
            "/api/purchase-receipts",
            json=receipt_payload(
                supplier["id"],
                item["id"],
                unit["id"],
                quantity=2,
                unit_price=100_000,
                shipping_fee=20_000,
                payment_status="PAID",
                payment={
                    "account_type": "CASH",
                    "fund_account_id": account["id"],
                },
            ),
        )
        assert created.status_code == 201
        receipt = created.json()
        assert receipt["total_amount"] == 220_000

        accounts_after_pay = client.get("/api/fund-accounts?type=CASH").json()
        assert accounts_after_pay[0]["current_balance"] == 780_000

        voided = client.post(
            f"/api/purchase-receipts/{receipt['id']}/void-for-reentry"
        )
        assert voided.status_code == 200
        voided_body = voided.json()
        assert voided_body["is_void"] is True
        assert voided_body["payment_account_type"] == "CASH"
        assert voided_body["payment_fund_account_id"] == account["id"]

        accounts_after_void = client.get("/api/fund-accounts?type=CASH").json()
        assert accounts_after_void[0]["current_balance"] == 1_000_000

        replacement = client.post(
            "/api/purchase-receipts",
            json=receipt_payload(
                supplier["id"],
                item["id"],
                unit["id"],
                quantity=3,
                unit_price=100_000,
                payment_status="DEBT",
                replaces_receipt_id=receipt["id"],
            ),
        )
        assert replacement.status_code == 201
        replacement_body = replacement.json()
        assert replacement_body["replaces_receipt_code"] == receipt["receipt_code"]

        old = client.get(f"/api/purchase-receipts/{receipt['id']}").json()
        assert old["replacement_receipt_code"] == replacement_body["receipt_code"]

    with sqlite3.connect(db_path) as connection:
        stock = connection.execute(
            """
            SELECT COALESCE(SUM(quantity_delta), 0)
            FROM inventory_movements
            WHERE item_id = ?
            """,
            (item["id"],),
        ).fetchone()[0]
        active_payment_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM fund_transactions
            WHERE source_type = 'PURCHASE_RECEIPT'
              AND source_id = ?
              AND is_void = 0
            """,
            (str(receipt["id"]),),
        ).fetchone()[0]
        void_movement_time = connection.execute(
            """
            SELECT movement_time
            FROM inventory_movements
            WHERE source_type = 'PURCHASE_RECEIPT_VOID'
              AND source_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (str(receipt["id"]),),
        ).fetchone()[0]

    assert stock == 3
    assert active_payment_count == 0
    assert void_movement_time == voided_body["voided_at"]
    assert void_movement_time != receipt["receipt_time"]
