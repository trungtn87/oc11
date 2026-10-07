import { useState } from "react";
import "./PosApp.css";

type PosView = "ORDERS" | "MAP";

export default function PosApp() {
  const [view, setView] = useState<PosView>("ORDERS");

  return (
    <div className="oc11-pos">
      <header className="pos-topbar">
        <button
          className="pos-home"
          type="button"
          onClick={() => setView("ORDERS")}
          aria-label="Trang Order"
        >
          ⌂
        </button>

        <button
          type="button"
          className={view === "ORDERS" ? "active" : ""}
          onClick={() => setView("ORDERS")}
        >
          🧾 Order
        </button>

        <button
          type="button"
          className={view === "MAP" ? "active" : ""}
          onClick={() => setView("MAP")}
        >
          ▥ Sơ đồ
        </button>

        <div className="pos-topbar-spacer" />

        <button
          type="button"
          className="pos-new-order"
          onClick={() => setView("ORDERS")}
        >
          ＋ ORDER
        </button>

        <div className="pos-brand">ỐC 11 POS</div>
      </header>

      <main className={view === "MAP" ? "pos-map-view" : "pos-order-view"}>
        <div
          style={{
            height: "100%",
            background: "#f4f4f4",
            display: "grid",
            placeItems: "center",
            padding: 24
          }}
        >
          <div
            style={{
              width: "min(680px, 92vw)",
              background: "#fff",
              border: "1px solid #d8d8d8",
              borderRadius: 8,
              padding: "34px 40px",
              textAlign: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,.06)"
            }}
          >
            <div
              style={{
                fontSize: 30,
                fontWeight: 800,
                color: "#087bbb",
                marginBottom: 10
              }}
            >
              {view === "MAP" ? "Sơ đồ bàn" : "Order"}
            </div>
            <div style={{ fontSize: 16, color: "#5f6368", lineHeight: 1.7 }}>
              Khung ứng dụng POS PC đã chạy độc lập với Web quản lý.
              <br />
              Chức năng nghiệp vụ sẽ được triển khai từng bước sau khi chốt.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
