"""Coverage for configurable 80mm POS slips."""
from fastapi.testclient import TestClient
from backend.app.main import app


def test_template_preview_and_persistence(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "data"))
    with TestClient(app) as client:
        initial = client.get("/api/pos/print-templates")
        assert initial.status_code == 200
        presets = initial.json()
        assert set(presets) == {"KITCHEN", "CHECK", "ESTIMATE", "RECEIPT"}
        custom = {**presets["ESTIMATE"], "printer_name": "Máy in phụ",
                  "title_text": "TẠM TÍNH BÀN",
                  "body_font_pt": 16, "show_options": False}
        saved = client.put("/api/pos/print-templates/ESTIMATE", json=custom)
        assert saved.status_code == 200, saved.text
        assert client.get("/api/pos/print-templates").json()["ESTIMATE"] == custom
        response = client.post("/api/pos/print-templates/preview",
                               json={"kind": "ESTIMATE", "template": custom})
        assert response.status_code == 200
        assert "TẠM TÍNH BÀN" in response.json()["text"]
        assert "CHƯA THANH TOÁN" in response.json()["text"]
        assert "+ Hấp" not in response.json()["text"]
        assert client.put("/api/pos/print-templates/CHECK",
            json={**presets["CHECK"], "body_font_pt": 30}).status_code == 422
        assert client.delete("/api/pos/print-templates/ESTIMATE").json() == presets["ESTIMATE"]


def test_sample_print_printer_routing(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "data"))
    sent = []
    monkeypatch.setattr("backend.app.pos.print_text",
        lambda printer, text: (sent.append((printer, text)) or True, None))
    with TestClient(app) as client:
        assert client.put("/api/pos/settings", json={
            "kitchen_printer_name": "Bep", "cashier_printer_name": "Thu ngan",
            "send_kitchen_targets": "BOTH", "print_receipt_targets": "CASHIER"
        }).status_code == 200
        defaults = client.get("/api/pos/print-templates").json()
        for kind, expected in [("KITCHEN", "Bep"), ("CHECK", "Thu ngan"),
                               ("ESTIMATE", "Thu ngan"), ("RECEIPT", "Thu ngan")]:
            result = client.post("/api/pos/print-templates/" + kind + "/test",
                json={**defaults[kind], "body_font_pt": 17})
            assert result.status_code == 200 and result.json()["ok"]
            assert sent[-1][0] == expected
            assert "__OC11_FONT:" in sent[-1][1]
            assert "BẢN IN THỬ - KHÔNG CÓ GIÁ TRỊ" in sent[-1][1]
        assert "CHƯA THANH TOÁN" in sent[2][1]
        assert "ĐÃ THANH TOÁN" in sent[3][1]


def test_each_template_can_override_its_printer_for_real_orders(tmp_path, monkeypatch):
    from backend.tests.test_pos import seed_menu

    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "data"))
    sent = []
    monkeypatch.setattr("backend.app.pos.print_text",
        lambda printer, text: (sent.append((printer, text)) or True, None))
    with TestClient(app) as client:
        seed_id = seed_menu(tmp_path / "oc11.db")
        assert client.put("/api/pos/settings", json={
            "kitchen_printer_name": "Bep",
            "cashier_printer_name": "Thu ngan",
            "send_kitchen_targets": "BOTH",
            "print_receipt_targets": "BOTH"
        }).status_code == 200

        defaults = client.get("/api/pos/print-templates").json()
        assert all(defaults[kind]["printer_name"] == "" for kind in defaults)
        assignments = {
            "KITCHEN": "Thu ngan",
            "CHECK": "Bep",
            "ESTIMATE": "May in so 3",
            "RECEIPT": "May in so 4"
        }
        for kind, name in assignments.items():
            result = client.put("/api/pos/print-templates/" + kind,
                json={**defaults[kind], "printer_name": name})
            assert result.status_code == 200, result.text

        order = client.post("/api/sales/orders", json={
            "order_type": "TAKEAWAY",
            "items": [{"menu_item_id": seed_id, "quantity": 1}]
        })
        assert order.status_code == 201, order.text
        order_id = order.json()["id"]
        sent_kitchen = client.post(f"/api/pos/orders/{order_id}/send-kitchen")
        assert sent_kitchen.status_code == 200, sent_kitchen.text
        assert sent_kitchen.json()["print_status"] == "PRINTED"
        assert [name for name, _ in sent] == ["Thu ngan", "Bep"]
        assert "CHẾ BIẾN" in sent[0][1]
        assert "[ ]" in sent[1][1]
        assert client.post(f"/api/pos/orders/{order_id}/send-kitchen").json()[
            "print_status"] == "NO_NEW_ITEMS"
        assert len(sent) == 2

        estimate = client.post(f"/api/pos/orders/{order_id}/print-estimate")
        assert estimate.status_code == 200, estimate.text
        assert estimate.json()["printer_results"][0]["printer_name"] == "May in so 3"
        assert sent[-1][0] == "May in so 3"

        account = client.get("/api/fund-accounts?type=CASH").json()[0]["id"]
        paid = client.post(f"/api/sales/orders/{order_id}/pay",
                           json={"fund_account_id": account})
        assert paid.status_code == 200, paid.text
        receipt = client.post(f"/api/pos/orders/{order_id}/print-receipt")
        assert receipt.status_code == 200, receipt.text
        assert receipt.json()["print_status"] == "PRINTED"
        assert [name for name, _ in sent] == [
            "Thu ngan", "Bep", "May in so 3", "May in so 4"
        ]


def test_unsaved_printer_selection_applies_to_sample_only(tmp_path, monkeypatch):
    monkeypatch.setenv("OC11_DB_PATH", str(tmp_path / "oc11.db"))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "data"))
    sent = []
    monkeypatch.setattr("backend.app.pos.print_text",
        lambda printer, text: (sent.append((printer, text)) or True, None))
    with TestClient(app) as client:
        defaults = client.get("/api/pos/print-templates").json()
        sample = client.post("/api/pos/print-templates/CHECK/test",
            json={**defaults["CHECK"], "printer_name": "May test"})
        assert sample.status_code == 200, sample.text
        assert sample.json()["ok"] is True
        assert sent[0][0] == "May test"
        assert "BẢN IN THỬ" in sent[0][1]
        assert client.get("/api/pos/print-templates").json()["CHECK"]["printer_name"] == ""

        other = client.post("/api/pos/print-templates/ESTIMATE/test",
            json=defaults["ESTIMATE"])
        assert other.json()["ok"] is False
        assert "cấu hình" in other.json()["error"]


def test_template_printer_mapping_respects_kitchen_menu_exclusions(tmp_path, monkeypatch):
    """Integration: PR #28 templates + PR #30 dish selections stay independent."""
    from backend.tests.test_pos import seed_menu
    from backend.tests.test_menu_kitchen_print import add_drink

    db_path = tmp_path / "oc11.db"
    monkeypatch.setenv("OC11_DB_PATH", str(db_path))
    monkeypatch.setenv("OC11_DATA_DIR", str(tmp_path / "data"))
    sent = []
    monkeypatch.setattr(
        "backend.app.pos.print_text",
        lambda printer, content: (sent.append((printer, content)) or True, None)
    )

    with TestClient(app) as client:
        seafood = seed_menu(db_path)
        water = add_drink(db_path)
        assert client.put("/api/pos/settings", json={
            "kitchen_printer_name": "Bep goc",
            "cashier_printer_name": "Thu ngan goc",
        }).status_code == 200
        assert client.put("/api/menu/kitchen-print-items", json={"items": [
            {"menu_item_id": water, "print_to_kitchen": False}
        ]}).status_code == 200

        defaults = client.get("/api/pos/print-templates").json()
        for kind, name in [("KITCHEN", "Bep tuy chon"), ("CHECK", "Thu ngan tuy chon")]:
            saved = client.put("/api/pos/print-templates/" + kind, json={
                **defaults[kind], "printer_name": name,
            })
            assert saved.status_code == 200, saved.text

        mixed = client.post("/api/sales/orders", json={
            "order_type": "TAKEAWAY", "items": [
                {"menu_item_id": seafood, "quantity": 1},
                {"menu_item_id": water, "quantity": 2},
            ]
        })
        assert mixed.status_code == 201, mixed.text
        order_id = mixed.json()["id"]

        result = client.post(f"/api/pos/orders/{order_id}/send-kitchen")
        assert result.status_code == 200 and result.json()["print_status"] == "PRINTED"
        assert [name for name, _ in sent] == ["Bep tuy chon", "Thu ngan tuy chon"]
        assert "Ốc luộc" in sent[0][1]
        assert "Nước suối" not in sent[0][1]
        assert "Ốc luộc" in sent[1][1] and "Nước suối" in sent[1][1]
        assert "__OC11_FONT:" in sent[0][1] and "__OC11_FONT:" in sent[1][1]
        assert client.post(f"/api/pos/orders/{order_id}/send-kitchen").json()[
            "print_status"
        ] == "NO_NEW_ITEMS"
        assert len(sent) == 2

        drinks_only = client.post("/api/sales/orders", json={
            "order_type": "TAKEAWAY", "items": [
                {"menu_item_id": water, "quantity": 1},
            ]
        })
        assert drinks_only.status_code == 201, drinks_only.text
        result = client.post(f"/api/pos/orders/{drinks_only.json()['id']}/send-kitchen")
        assert result.status_code == 200 and result.json()["print_status"] == "PRINTED"
        assert [name for name, _ in sent] == [
            "Bep tuy chon", "Thu ngan tuy chon", "Thu ngan tuy chon"
        ]
