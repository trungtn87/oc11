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
        custom = {**presets["ESTIMATE"], "title_text": "TẠM TÍNH BÀN",
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
