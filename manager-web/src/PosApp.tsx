import { useEffect, useState } from "react";
import { message } from "antd";

import { getRestaurantAreas, getRestaurantTables } from "./api";
import type { RestaurantArea, RestaurantTable } from "./types";
import "./PosApp.css";

type PosView = "ORDERS" | "MAP";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function defaultTablePosition(index: number) {
  const columns = 5;
  return {
    x: 4 + (index % columns) * 19,
    y: 6 + Math.floor(index / columns) * 19
  };
}

function tablePosition(table: RestaurantTable, index: number) {
  if (table.pos_x === 0 && table.pos_y === 0) {
    return defaultTablePosition(index);
  }
  return {
    x: clamp(table.pos_x, 0, 84),
    y: clamp(table.pos_y, 0, 84)
  };
}

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
  const areaTables = tables
    .filter((table) => table.area_id === selectedAreaId)
    .sort(
      (left, right) =>
        left.display_order - right.display_order || left.id - right.id
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
          className="pos-menu-wrap"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="pos-menu-button"
            aria-label="Menu"
            onClick={() => setMenuOpen((current) => !current)}
          >
            ☰
          </button>

          {menuOpen && (
            <div className="pos-menu-popup">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  window.open("/", "_blank", "noopener,noreferrer");
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
                <span className="pos-map-chevron">›</span>
                <strong>{selectedArea.name}:</strong>
                <span>
                  Trống {areaEmpty}/{areaTables.length} bàn
                </span>
              </>
            )}

            <span className="pos-legend pos-legend-first">
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
              {areaTables.map((table, index) => {
                const position = tablePosition(table, index);
                return (
                  <button
                    key={table.id}
                    type="button"
                    className={`pos-table ${
                      table.open_order_id ? "busy" : "empty"
                    }`}
                    style={{
                      left: `${position.x}%`,
                      top: `${position.y}%`
                    }}
                  >
                    <span className="table-icon">▣</span>
                    <strong>{table.name}</strong>
                    {table.open_order_id && <small>Đang phục vụ</small>}
                  </button>
                );
              })}

              {!loading && selectedArea && areaTables.length === 0 && (
                <div className="pos-empty">Khu vực này chưa có bàn.</div>
              )}

              {loading && (
                <div className="pos-empty">Đang tải sơ đồ bàn...</div>
              )}
            </section>
          </div>
        </main>
      ) : (
        <main className="pos-order-view">
          <div className="pos-placeholder">
            <div className="pos-placeholder-card">
              <div className="pos-placeholder-title">Order</div>
              <div className="pos-placeholder-text">
                Phần danh sách Order sẽ làm ở bước sau.
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
