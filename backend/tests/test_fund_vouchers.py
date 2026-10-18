import sqlite3

from fastapi.testclient import TestClient

from backend.app.main import app


def add_account(client, name, account_type, opening_amount):
    response = client.post(
        "/api/fund-accounts",
        json={"name": name, "type": account_type, "is_active": True},
    )
    assert response.status_code == 201, response.text
    account = response.json()
    opening = client.post(
        "/api/fund-transactions",
        json={
            "account_type": account_type,
            "fund_account_id": account["id"],
            "direction": "IN",
            "transaction_type": "OPENING_BALANCE",
            "transaction_time": "2026-10-01T08:00",
            "amount": opening_amount,
        },
    )
    assert opening.status_code == 201, opening.text
    return account, opening.json()["created_ids"][0]


def add_category(client, direction):
    response = client.post(
        "/api/fund-transaction-categories",
        json={"name": "Thu khác" if direction == "IN" else "Chi khác", "direction": direction},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def add_voucher(client, account, direction, category_id, amount, **kwargs):
    response = client.post(
        "/api/fund-transactions",
        json={
            "account_type": account["type"],
            "fund_account_id": account["id"],
            "direction": direction,
            "transaction_type": "NORMAL",
            "transaction_time": "2026-10-12T09:00",
            "category_id": category_id,
            "amount": amount,
            "description": "Phiếu tự nhập",
            **kwargs,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["created_ids"][0]


def balance(client, account_type, account_id):
    response = client.get(f"/api/fund-accounts?type={account_type}")
    assert response.status_code == 200
    return next(row["current_balance"] for row in response.json() if row["id"] == account_id)


def test_manual_voucher_update_move_account_and_void(tmp_path, monkeypatch):
    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))

    with TestClient(app) as client:
        cash, _ = add_account(client, "Quỹ quán", "CASH", 1_000_000)
        bank, _ = add_account(client, "BIDV", "BANK", 500_000)
        category_id = add_category(client, "OUT")
        voucher_id = add_voucher(client, cash, "OUT", category_id, 100_000)
        assert balance(client, "CASH", cash["id"]) == 900_000

        payload = {
            "fund_account_id": cash["id"],
            "transaction_time": "2026-10-10T07:15",
            "category_id": category_id,
            "amount": 200_000,
            "description": "Đã chỉnh",
            "note": "Sửa nhầm tiền",
        }
        response = client.put(f"/api/fund-transactions/{voucher_id}", json=payload)
        assert response.status_code == 200, response.text
        assert balance(client, "CASH", cash["id"]) == 800_000

        payload["fund_account_id"] = bank["id"]
        moved = client.put(f"/api/fund-transactions/{voucher_id}", json=payload)
        assert moved.status_code == 200, moved.text
        assert balance(client, "CASH", cash["id"]) == 1_000_000
        assert balance(client, "BANK", bank["id"]) == 300_000

        ledger = client.get("/api/fund-transactions", params={"account_type": "BANK"})
        record = next(row for row in ledger.json()["items"] if row["id"] == voucher_id)
        assert record["amount"] == 200_000
        assert record["description"] == "Đã chỉnh"
        assert record["transaction_time"] == "2026-10-10T07:15"

        deleted = client.delete(f"/api/fund-transactions/{voucher_id}")
        assert deleted.status_code == 200
        assert balance(client, "BANK", bank["id"]) == 500_000
        assert not any(
            row["id"] == voucher_id
            for row in client.get("/api/fund-transactions", params={"account_type": "BANK"}).json()["items"]
        )
        assert client.delete(f"/api/fund-transactions/{voucher_id}").status_code == 409

    with sqlite3.connect(db_path) as connection:
        assert connection.execute(
            "SELECT is_void FROM fund_transactions WHERE id = ?", (voucher_id,)
        ).fetchone()[0] == 1


def test_linked_and_special_transactions_reject_mutations(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        cash, opening_id = add_account(client, "Quỹ thu", "CASH", 1_000_000)
        other, _ = add_account(client, "Quỹ chi", "CASH", 100_000)
        category_id = add_category(client, "IN")
        linked_id = add_voucher(
            client, cash, "IN", category_id, 50_000,
            source_type="SALE", source_id="999",
        )
        transfer = client.post(
            "/api/fund-transactions",
            json={
                "account_type": "CASH",
                "fund_account_id": cash["id"],
                "direction": "OUT",
                "transaction_type": "TRANSFER",
                "transaction_time": "2026-10-12T10:00",
                "related_fund_account_id": other["id"],
                "amount": 25_000,
            },
        )
        assert transfer.status_code == 201, transfer.text
        transfer_id = transfer.json()["created_ids"][0]

        edit = {
            "fund_account_id": cash["id"],
            "transaction_time": "2026-10-12T11:00",
            "category_id": category_id,
            "amount": 100_000,
        }
        for transaction_id in (opening_id, linked_id, transfer_id):
            assert client.put(
                f"/api/fund-transactions/{transaction_id}", json=edit
            ).status_code == 409
            assert client.delete(f"/api/fund-transactions/{transaction_id}").status_code == 409

        manual_id = add_voucher(client, cash, "IN", category_id, 10_000)
        # Reject a deletion that would create a negative current balance.
        cash_2, _ = add_account(client, "Quỹ ít tiền", "CASH", 10_000)
        cash_2_voucher = add_voucher(client, cash_2, "IN", category_id, 30_000)
        out_cat = add_category(client, "OUT")
        add_voucher(client, cash_2, "OUT", out_cat, 35_000)
        assert client.delete(f"/api/fund-transactions/{cash_2_voucher}").status_code == 409
        assert client.put(f"/api/fund-transactions/{manual_id}", json={
            **edit, "amount": 0,
        }).status_code == 422
