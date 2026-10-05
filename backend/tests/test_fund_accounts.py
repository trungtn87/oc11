from fastapi.testclient import TestClient

from backend.app.main import app


def create_account(
    client: TestClient,
    *,
    name: str,
    account_type: str,
    is_default: bool = False,
    is_active: bool = True,
):
    response = client.post(
        "/api/fund-accounts",
        json={
            "name": name,
            "type": account_type,
            "bank_name": "MB" if account_type == "BANK" else None,
            "account_number": "123" if account_type == "BANK" else None,
            "account_name": "OC11" if account_type == "BANK" else None,
            "note": None,
            "is_active": is_active,
            "is_default": is_default,
        },
    )
    return response


def test_first_active_account_becomes_default_and_can_switch(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        first = create_account(
            client,
            name="Quỹ quán",
            account_type="CASH",
        )
        assert first.status_code == 201
        assert first.json()["is_default"] is True

        second = create_account(
            client,
            name="Quỹ đi chợ",
            account_type="CASH",
        )
        assert second.status_code == 201
        assert second.json()["is_default"] is False

        payload = second.json()
        payload.pop("id")
        payload.pop("current_balance")
        payload.pop("can_delete")
        payload["is_default"] = True

        updated = client.put(
            f"/api/fund-accounts/{second.json()['id']}",
            json=payload,
        )
        assert updated.status_code == 200
        assert updated.json()["is_default"] is True

        rows = client.get("/api/fund-accounts", params={"type": "CASH"})
        assert rows.status_code == 200
        values = rows.json()
        defaults = [row for row in values if row["is_default"]]
        assert len(defaults) == 1
        assert defaults[0]["id"] == second.json()["id"]


def test_cash_and_bank_have_independent_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        cash = create_account(
            client,
            name="Quỹ quán",
            account_type="CASH",
        )
        bank = create_account(
            client,
            name="MB Bank quán",
            account_type="BANK",
        )

        assert cash.status_code == 201
        assert bank.status_code == 201
        assert cash.json()["is_default"] is True
        assert bank.json()["is_default"] is True


def test_default_account_cannot_be_inactive(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))

    with TestClient(app) as client:
        response = create_account(
            client,
            name="Quỹ lỗi",
            account_type="CASH",
            is_default=True,
            is_active=False,
        )
        assert response.status_code == 422
