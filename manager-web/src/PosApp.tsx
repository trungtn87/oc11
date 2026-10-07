import { useEffect, useState } from "react";
import { message } from "antd";

import { getRestaurantAreas, getRestaurantTables } from "./api";
import type { RestaurantArea, RestaurantTable } from "./types";
import "./PosApp.css";

type PosView = "ORDERS" | "MAP";

export default function PosApp() {
  const [view, setView] = useState<PosView>("MAP");
  const [areas, setAreas] = useState<RestaurantArea[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [areaRows, tableRows] = await Promise.all([
          getRestaurantAreas(true),
          getRestaurantTables({ active_only: true })
        ]);

        if (cancelled) return;

        setAreas(areaRows);
        setTables(tableRows);
        setSelectedAreaId((current) =>
          current ?? (areaRows.length > 0 ? areaRows[0].id : null)
        );
      } catch (error) {
        if (!cancelled) {
          messageApi.error(
            error instanceof Error
              ? error.message
              : "Không tải được sơ đồ bàn."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedArea =
    areas.find((area) => area.id === selectedAreaId) ?? null;
  const areaTables = tables.filter(
    (table) => table.area_id === selectedAreaId
  );
  const totalEmpty = tables.filter((table) => !table.open_order_id).length;
  const areaEmpty = areaTables.filter((table) => !table.open_order_id).length;

  return (
    <div className="oc11-pos" onClick={() => menuOpen && setMenuOpen(false)}>
      {contextHolder}

      <header className="pos-topbar">
        <button
          className="pos-home"
          type="button"
          onClick={() => setView("MAP")}
          aria-label="Sơ đồ bàn"
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

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "stretch"
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Menu"
            onClick={() => setMenuOpen((current) => !current)}
            style={{
              fontSize: 26,
              lineHeight: 1,
              padding: "0 22px"
            }}
          >
            ☰
          </button>

          {menuOpen && (
            <div
              style={{
                position: "absolute",
                right: 8,
                top: 48,
                width: 190,
                background: "#fff",
                border: "1px solid #cfcfcf",
                boxShadow: "0 4px 12px rgba(0,0,0,.18)",
                zIndex: 50
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  window.open("/", "_blank", "noopener,noreferrer");
                }}
                style={{
                  width: "100%",
                  height: 46,
                  border: 0,
                  background: "#fff",
                  color: "#222",
                  textAlign: "left",
                  padding: "0 16px",
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Đến Web quản lý
              </button>
            </div>
          )}
        </div>
      </header>

      {view === "MAP" ? (
        <main className="pos-map-view">
          <div className="pos-map-summary">
            <strong>Toàn bộ nhà hàng:</strong>
            <span>
              Trống {totalEmpty}/{tables.length} bàn
            </span>

            {selectedArea && (
              <>
                <span style={{ color: "#8a8a8a" }}>›</span>
                <strong>{selectedArea.name}:</strong>
                <span>
                  Trống {areaEmpty}/{areaTables.length} bàn
                </span>
              </>
            )}

            <span className="pos-legend" style={{ marginLeft: "auto" }}>
              <i className="empty" /> Bàn trống
            </span>
            <span className="pos-legend">
              <i className="busy" /> Bàn đang phục vụ
            </span>
          </div>

          <div className="pos-map-body">
            <aside className="pos-area-list">
              {areas.map((area) => {
                const rows = tables.filter(
                  (table) => table.area_id === area.id
                );
                const empty = rows.filter(
                  (table) => !table.open_order_id
                ).length;

                return (
                  <button
                    key={area.id}
                    type="button"
                    className={selectedAreaId === area.id ? "active" : ""}
                    onClick={() => setSelectedAreaId(area.id)}
                  >
                    <b>
                      {area.name} ({rows.length})
                    </b>
                    <span>
                      {empty}/{rows.length} trống
                    </span>
                  </button>
                );
              })}

              {!loading && areas.length === 0 && (
                <div className="pos-empty">
                  Chưa có khu vực. Tạo khu vực và bàn trong Web quản lý → Cài đặt.
                </div>
              )}
            </aside>

            <section className="pos-table-map">
              {areaTables.map((table) => (
                <button
                  key={table.id}
                  type="button"
                  className={`pos-table ${
                    table.open_order_id ? "busy" : "empty"
                  }`}
                >
                  <span className="table-icon">▣</span>
                  <strong>{table.name}</strong>
                  {table.open_order_id ? (
                    <small>Đang phục vụ</small>
                  ) : (
                    <small>
                      {table.seats > 0 ? `${table.seats} ghế` : "Trống"}
                    </small>
                  )}
                </button>
              ))}

              {!loading && selectedArea && areaTables.length === 0 && (
                <div className="pos-empty">
                  Khu vực này chưa có bàn.
                </div>
              )}

              {loading && (
                <div className="pos-empty">Đang tải sơ đồ bàn...</div>
              )}
            </section>
          </div>
        </main>
      ) : (
        <main className="pos-order-view">
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
                Order
              </div>
              <div
                style={{
                  fontSize: 16,
                  color: "#5f6368",
                  lineHeight: 1.7
                }}
              >
                Phần danh sách Order sẽ làm ở bước sau.
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
