import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Input,
  InputNumber,
  message,
  Modal,
  Select
} from "antd";

import {
  createSaleOrder,
  createSurchargePreset,
  getFundAccounts,
  getMenuItems,
  getRestaurantAreas,
  getRestaurantTables,
  getSaleOrder,
  getSaleOrders,
  getSurchargePresets,
  paySaleOrder,
  sendSaleOrderToKitchen,
  updateSaleOrder
} from "./api";
import type {
  FundAccount,
  FundAccountType,
  MenuItem,
  MenuItemOption,
  RestaurantArea,
  RestaurantTable,
  SaleOrder,
  SaleOrderInput,
  SaleSurchargeInput,
  SurchargePreset
} from "./types";
import "./PosApp.css";

type PosView = "MAP" | "ORDERS" | "SALE";

type CartLine = {
  key: string;
  menuItemId: number;
  optionId: number | null;
  name: string;
  optionName: string | null;
  unitPrice: number;
  quantity: number;
  note: string;
  surcharges: SaleSurchargeInput[];
};

const money = (value: number) =>
  new Intl.NumberFormat("vi-VN").format(Math.round(value));

function defaultPosition(index: number) {
  return {
    x: 4 + (index % 5) * 19,
    y: 6 + Math.floor(index / 5) * 19
  };
}

function tablePosition(table: RestaurantTable, index: number) {
  if (table.pos_x === 0 && table.pos_y === 0) return defaultPosition(index);
  return {
    x: Math.max(0, Math.min(84, table.pos_x)),
    y: Math.max(0, Math.min(84, table.pos_y))
  };
}

function rowTotal(line: CartLine): number {
  return (
    line.quantity * line.unitPrice +
    line.surcharges.reduce((total, extra) => total + extra.amount, 0)
  );
}

function timeSince(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "";
  const minutes = Math.floor(elapsed / 60_000);
  return minutes < 60
    ? `${minutes} phút`
    : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

let newLineSequence = 0;

export default function PosApp() {
  const [view, setView] = useState<PosView>("MAP");
  const [areas, setAreas] = useState<RestaurantArea[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [surchargePresets, setSurchargePresets] = useState<SurchargePreset[]>([]);
  const menuGridRef = useRef<HTMLDivElement | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingOrder, setEditingOrder] = useState<SaleOrder | null>(null);
  const [tableId, setTableId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [optionItem, setOptionItem] = useState<MenuItem | null>(null);
  const [noteLineKey, setNoteLineKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const [surchargeLineKey, setSurchargeLineKey] = useState<string | null>(null);
  const [surchargePresetId, setSurchargePresetId] = useState<number | undefined>();
  const [surchargeName, setSurchargeName] = useState("");
  const [surchargeAmount, setSurchargeAmount] = useState(0);
  const [surchargeSaving, setSurchargeSaving] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAccountType, setPaymentAccountType] = useState<FundAccountType>("CASH");
  const [paymentFundAccountId, setPaymentFundAccountId] = useState<number>();
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [messageApi, contextHolder] = message.useMessage();

  async function refresh() {
    const [areaRows, tableRows, openOrders] = await Promise.all([
      getRestaurantAreas(true),
      getRestaurantTables({ active_only: true }),
      getSaleOrders({ status: "OPEN" })
    ]);

    setAreas(areaRows);
    setTables(tableRows);
    setOrders(openOrders.filter((order) => order.order_type === "DINE_IN"));
    setSelectedAreaId((current) =>
      current !== null && areaRows.some((area) => area.id === current)
        ? current
        : areaRows[0]?.id ?? null
    );
  }

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const [menu, funds, presets] = await Promise.all([
          getMenuItems(), getFundAccounts(), getSurchargePresets()
        ]);
        if (cancelled) return;
        setMenuItems(menu.filter((item) => item.is_active));
        setAccounts(funds);
        setSurchargePresets(presets);
        await refresh();
      } catch (error) {
        if (!cancelled) {
          messageApi.error(
            error instanceof Error ? error.message : "Không tải được dữ liệu POS."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedArea =
    areas.find((area) => area.id === selectedAreaId) ?? null;
  const areaTables = tables
    .filter((table) => table.area_id === selectedAreaId)
    .sort(
      (a, b) => a.display_order - b.display_order || a.id - b.id
    );
  const emptyCount = tables.filter((table) => !table.open_order_id).length;
  const areaEmptyCount = areaTables.filter((table) => !table.open_order_id).length;

  const groups = useMemo(() => {
    const unique = new Map<number, string>();
    menuItems.forEach((item) => unique.set(item.menu_group_id, item.menu_group_name));
    return Array.from(unique, ([id, name]) => ({ id, name }));
  }, [menuItems]);

  const filteredMenu = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("vi");
    return menuItems.filter(
      (item) =>
        (groupId === null || item.menu_group_id === groupId) &&
        (!term || item.name.toLocaleLowerCase("vi").includes(term))
    );
  }, [menuItems, groupId, search]);

  const total = useMemo(
    () =>
      cart.reduce((sum, item) => sum + rowTotal(item), 0) +
      (editingOrder?.surcharges.reduce((sum, item) => sum + item.amount, 0) ?? 0),
    [cart, editingOrder]
  );

  const selectedTable = tables.find((table) => table.id === tableId);

  function newOrder(table: RestaurantTable) {
    setEditingOrder(null);
    setTableId(table.id);
    setCart([]);
    setSelectedLineKey(null);
    setDirty(false);
    setSearch("");
    setGroupId(null);
    setView("SALE");
  }

  async function openExisting(orderId: number) {
    setBusy(true);
    try {
      const order = await getSaleOrder(orderId);
      if (order.status !== "OPEN" || order.order_type !== "DINE_IN") {
        messageApi.warning("Order này không còn đang phục vụ.");
        await refresh();
        return;
      }
      // Keep the entire existing order, including notes and surcharges, on edit.
      if (order.items.some((item) => item.menu_item_id === null)) {
        messageApi.warning("Order có món ngoài thực đơn, hãy sửa trên Web quản lý.");
        return;
      }

      setEditingOrder(order);
      setTableId(order.table_id);
      setCart(
        order.items.map((item) => ({
          key: `saved-${item.id}`,
          menuItemId: item.menu_item_id as number,
          optionId: item.menu_item_option_id,
          name: item.item_name_snapshot,
          optionName: item.option_name_snapshot,
          unitPrice: item.unit_price,
          quantity: item.quantity,
          note: item.note ?? "",
          surcharges: item.surcharges.map((extra) => ({
            name: extra.name,
            amount: extra.amount
          }))
        }))
      );
      setSelectedLineKey(null);
      setDirty(false);
      setSearch("");
      setGroupId(null);
      setView("SALE");
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không mở được Order."
      );
    } finally {
      setBusy(false);
    }
  }

  function openTable(table: RestaurantTable) {
    if (busy) return;
    if (table.open_order_id !== null) {
      void openExisting(table.open_order_id);
    } else {
      newOrder(table);
    }
  }

  function addItem(item: MenuItem, option: MenuItemOption | null = null) {
    const optionId = option?.id ?? null;
    const unitPrice = option?.sale_price ?? item.base_price;
    setCart((current) => {
      // Only merge identical plain lines. Keep annotated lines independent.
      const identical = current.find(
        (line) =>
          line.menuItemId === item.id &&
          line.optionId === optionId &&
          !line.note &&
          line.surcharges.length === 0
      );
      if (identical) {
        return current.map((line) =>
          line.key === identical.key
            ? { ...line, quantity: line.quantity + 1 }
            : line
        );
      }
      newLineSequence += 1;
      return [
        ...current,
        {
          key: `new-${newLineSequence}`,
          menuItemId: item.id,
          optionId,
          name: item.name,
          optionName: option?.service_option_name ?? null,
          unitPrice,
          quantity: 1,
          note: "",
          surcharges: []
        }
      ];
    });
    setDirty(true);
    setOptionItem(null);
  }

  function selectMenuItem(item: MenuItem) {
    const options = item.options.filter((option) => option.is_active);
    if (options.length) {
      setOptionItem(item);
    } else {
      addItem(item);
    }
  }

  function updateQuantity(key: string, quantity: number) {
    if (!Number.isFinite(quantity)) return;
    setCart((current) =>
      quantity <= 0
        ? current.filter((line) => line.key !== key)
        : current.map((line) =>
            line.key === key ? { ...line, quantity } : line
          )
    );
    if (quantity <= 0) setSelectedLineKey((current) => current === key ? null : current);
    setDirty(true);
  }

  function backToMap() {
    if (dirty) {
      Modal.confirm({
        title: "Chưa lưu thay đổi",
        content: "Những thay đổi trong Order chưa được lưu. Bạn muốn bỏ thay đổi?",
        okText: "Bỏ thay đổi",
        okButtonProps: { danger: true },
        cancelText: "Ở lại",
        onOk: () => {
          setDirty(false);
          setView("MAP");
          void refresh();
        }
      });
      return;
    }
    setView("MAP");
    void refresh();
  }

  function openSurcharge(key: string) {
    setSurchargeLineKey(key);
    setSurchargePresetId(undefined);
    setSurchargeName("");
    setSurchargeAmount(0);
  }

  async function addLineSurcharge() {
    const name = surchargeName.trim();
    const amount = Math.round(Number(surchargeAmount));
    if (!surchargeLineKey || !cart.some((line) => line.key === surchargeLineKey)) {
      messageApi.warning("Món này không còn trong Order.");
      return;
    }
    if (!name || name.length > 120 || !Number.isFinite(amount) || amount <= 0) {
      messageApi.warning("Nhập tên phụ thu và số tiền lớn hơn 0.");
      return;
    }
    setSurchargeSaving(true);
    try {
      const known = surchargePresets.some(
        (preset) => preset.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi")
      );
      if (!known) {
        const preset = await createSurchargePreset({ name, amount });
        setSurchargePresets((current) => [...current, preset].sort(
          (a, b) => a.name.localeCompare(b.name, "vi")
        ));
      }
      setCart((current) => current.map((line) => line.key === surchargeLineKey
        ? { ...line, surcharges: [...line.surcharges, { name, amount }] }
        : line
      ));
      setDirty(true);
      setSurchargeLineKey(null);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không lưu được phụ thu.");
    } finally {
      setSurchargeSaving(false);
    }
  }

  function removeLineSurcharge(key: string, index: number) {
    setCart((current) => current.map((line) => line.key === key
      ? { ...line, surcharges: line.surcharges.filter((_, i) => i !== index) }
      : line
    ));
    setDirty(true);
  }

  // Save before kitchen / payment so the backend receives the latest detail.
  async function saveOrder(returnToMap = true): Promise<SaleOrder | null> {
    if (busy) return null;
    if (tableId === null) {
      messageApi.error("Chưa chọn bàn.");
      return null;
    }
    if (!cart.length) {
      messageApi.warning("Chọn ít nhất một món trước khi lưu Order.");
      return null;
    }
    if (cart.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      messageApi.warning("Số lượng món phải lớn hơn 0.");
      return null;
    }
    if (editingOrder && !dirty) {
      if (returnToMap) {
        setView("MAP");
        await refresh().catch(() => messageApi.warning("Không tải lại được sơ đồ."));
      }
      return editingOrder;
    }

    const payload: SaleOrderInput = {
      order_type: "DINE_IN",
      table_id: tableId,
      guest_count: editingOrder?.guest_count ?? 0,
      customer_id: editingOrder?.customer_id ?? null,
      note: editingOrder?.note ?? null,
      payment_status: "DEBT",
      items: cart.map((line) => ({
        menu_item_id: line.menuItemId,
        menu_item_option_id: line.optionId,
        quantity: line.quantity,
        note: line.note || null,
        surcharges: line.surcharges
      })),
      surcharges: editingOrder?.surcharges.map((extra) => ({
        name: extra.name,
        amount: extra.amount
      })) ?? []
    };

    setBusy(true);
    try {
      const saved = editingOrder
        ? await updateSaleOrder(editingOrder.id, payload)
        : await createSaleOrder(payload);
      setDirty(false);
      setEditingOrder(saved);
      if (returnToMap) setView("MAP");
      messageApi.success(`Đã lưu ${saved.order_code}.`);
      await refresh().catch(() => messageApi.warning(
        "Order đã lưu nhưng chưa tải lại được sơ đồ."
      ));
      return saved;
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không lưu được Order.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function performSendKitchen() {
    const saved = await saveOrder(false);
    if (!saved) return;
    setBusy(true);
    try {
      const ticket = await sendSaleOrderToKitchen(saved.id);
      if (ticket.print_status !== "PRINTED") {
        messageApi.error(
          `Order đã lưu nhưng gửi bếp thất bại: ${ticket.error_message || "Kiểm tra máy in bếp."}`
        );
        return;
      }
      setEditingOrder({ ...saved, kitchen_sent_at: ticket.sent_at });
      messageApi.success(`Đã gửi bếp ${saved.order_code}.`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không gửi được bếp.");
    } finally {
      setBusy(false);
    }
  }

  function sendKitchen() {
    if (busy) return;
    if (editingOrder?.kitchen_sent_at) {
      Modal.confirm({
        title: "Gửi lại toàn bộ Order tới bếp?",
        content: "Phiếu bếp sẽ in lại TẤT CẢ món, kể cả món đã gửi trước đó.",
        okText: "Gửi lại",
        cancelText: "Không",
        onOk: () => performSendKitchen()
      });
    } else {
      void performSendKitchen();
    }
  }

  function openPayment() {
    if (busy) return;
    void (async () => {
      const saved = await saveOrder(false);
      if (!saved) return;
      const active = accounts.filter((account) => account.is_active);
      const preferred =
        active.find((account) => account.type === "CASH" && account.is_default) ??
        active.find((account) => account.type === "CASH") ??
        active.find((account) => account.is_default) ??
        active[0];
      setPaymentAccountType(preferred?.type ?? "CASH");
      setPaymentFundAccountId(preferred?.id);
      setPaymentAmount(saved.total_amount);
      setPaymentOpen(true);
    })();
  }

  async function confirmPayment() {
    if (!editingOrder || !paymentFundAccountId || busy) {
      if (!paymentFundAccountId) messageApi.warning("Chọn quỹ hoặc tài khoản nhận tiền.");
      return;
    }
    if (!Number.isFinite(paymentAmount) || (total > 0 && paymentAmount <= 0)) {
      messageApi.warning("Tiền thực thu phải lớn hơn 0.");
      return;
    }
    setBusy(true);
    try {
      const paid = await paySaleOrder(editingOrder.id, {
        fund_account_id: paymentFundAccountId,
        actual_received_amount: Math.round(paymentAmount)
      });
      setPaymentOpen(false);
      setEditingOrder(null);
      setCart([]);
      setTableId(null);
      setSelectedLineKey(null);
      setDirty(false);
      setView("MAP");
      messageApi.success(`Đã thanh toán ${paid.order_code}. Tiền đã ghi vào quỹ.`);
      await refresh().catch(() => messageApi.warning(
        "Đã thanh toán nhưng chưa cập nhật sơ đồ."
      ));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Thanh toán thất bại.");
    } finally {
      setBusy(false);
    }
  }

  function setViewSafely(next: "MAP" | "ORDERS") {
    if (view === "SALE" && dirty) {
      Modal.confirm({
        title: "Order chưa được lưu",
        content: "Bạn muốn bỏ các thay đổi và rời Order?",
        okText: "Rời Order",
        okButtonProps: { danger: true },
        cancelText: "Ở lại",
        onOk: () => {
          setDirty(false);
          setView(next);
          void refresh();
        }
      });
    } else {
      setView(next);
      void refresh();
    }
  }

  return (
    <div
      className="oc11-pos"
      onClick={() => menuOpen && setMenuOpen(false)}
    >
      {contextHolder}
      <header className="pos-topbar">
        <button
          className="pos-home"
          type="button"
          onClick={() => setViewSafely("MAP")}
          aria-label="Trang sơ đồ"
        >
          ⌂
        </button>
        <button
          type="button"
          className={view === "ORDERS" ? "active" : ""}
          onClick={() => setViewSafely("ORDERS")}
        >
          🧾 Order
        </button>
        <button
          type="button"
          className={view === "MAP" ? "active" : ""}
          onClick={() => setViewSafely("MAP")}
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

      {view === "MAP" && (
        <main className="pos-map-view">
          <div className="pos-map-summary">
            <strong>Toàn bộ nhà hàng:</strong>
            <span>Trống {emptyCount}/{tables.length} bàn</span>
            {selectedArea && (
              <>
                <span className="pos-map-chevron">›</span>
                <strong>{selectedArea.name}:</strong>
                <span>Trống {areaEmptyCount}/{areaTables.length} bàn</span>
              </>
            )}
            <button
              type="button"
              className="pos-refresh"
              onClick={() => void refresh().catch((error) =>
                messageApi.error(
                  error instanceof Error ? error.message : "Không làm mới được sơ đồ."
                )
              )}
            >
              ↻ Làm mới
            </button>
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
                const rows = tables.filter((table) => table.area_id === area.id);
                const empty = rows.filter((table) => !table.open_order_id).length;
                return (
                  <button
                    key={area.id}
                    type="button"
                    className={selectedAreaId === area.id ? "active" : ""}
                    onClick={() => setSelectedAreaId(area.id)}
                  >
                    <b>{area.name} ({rows.length})</b>
                    <span>{empty}/{rows.length} trống</span>
                  </button>
                );
              })}
              {!loading && areas.length === 0 && (
                <div className="pos-empty">
                  Chưa có khu vực. Thêm khu vực và bàn trong Web quản lý → Cài đặt.
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
                    disabled={busy}
                    className={`pos-table ${table.open_order_id ? "busy" : "empty"}`}
                    style={{ left: `${position.x}%`, top: `${position.y}%` }}
                    onClick={() => openTable(table)}
                  >
                    <span className="table-icon">▣</span>
                    <strong>{table.name}</strong>
                    {table.open_order_id !== null && (
                      <>
                        <small>{money(table.open_order_total ?? 0)} đ</small>
                        <small>Đang phục vụ</small>
                      </>
                    )}
                  </button>
                );
              })}
              {!loading && selectedArea && areaTables.length === 0 && (
                <div className="pos-empty">Khu vực này chưa có bàn.</div>
              )}
              {loading && <div className="pos-empty">Đang tải sơ đồ bàn...</div>}
            </section>
          </div>
        </main>
      )}

      {view === "ORDERS" && (
        <main className="pos-order-view">
          <div className="pos-order-toolbar">
            <b>Chờ thanh toán ({orders.length})</b>
            <Button onClick={() => void refresh()}>Làm mới</Button>
          </div>
          <div className="pos-active-orders">
            {orders.map((order) => (
              <button
                key={order.id}
                type="button"
                disabled={busy}
                className="pos-active-order-card"
                onClick={() => void openExisting(order.id)}
              >
                <div>
                  <strong>{order.area_name} · {order.table_name}</strong>
                  <span>{order.order_code}</span>
                </div>
                <div className="pos-active-order-total">
                  <b>{money(order.total_amount)} đ</b>
                  <span>{timeSince(order.order_time)}</span>
                </div>
              </button>
            ))}
            {!orders.length && (
              <div className="pos-empty">
                Chưa có Order nào. Vào Sơ đồ và chọn bàn trống để tạo Order.
              </div>
            )}
          </div>
        </main>
      )}

      {view === "SALE" && (
        <main className="pos-sale-view">
          <section className="pos-menu-side">
            <div className="pos-group-tabs">
              <button
                className={groupId === null ? "active" : ""}
                onClick={() => setGroupId(null)}
              >
                Tất cả
              </button>
              {groups.map((group) => (
                <button
                  key={group.id}
                  className={groupId === group.id ? "active" : ""}
                  onClick={() => setGroupId(group.id)}
                >
                  {group.name}
                </button>
              ))}
            </div>
            <div className="pos-search">
              <Input
                allowClear
                placeholder="Tìm món trong thực đơn..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="pos-menu-grid" ref={menuGridRef}>
              {filteredMenu.map((item) => {
                const activeOptions = item.options.filter((option) => option.is_active);
                return (
                  <button
                    type="button"
                    key={item.id}
                    className="pos-menu-item"
                    onClick={() => selectMenuItem(item)}
                  >
                    <span className="item-price">
                      {activeOptions.length
                        ? `Từ ${money(Math.min(...activeOptions.map((option) => option.sale_price)))}`
                        : money(item.base_price)}
                    </span>
                    <strong>{item.name}</strong>
                  </button>
                );
              })}
              {!filteredMenu.length && (
                <div className="pos-empty">Không có món phù hợp.</div>
              )}
            </div>
            <div className="pos-menu-scroll-controls">
              <button type="button" aria-label="Cuộn danh sách món lên"
                onClick={() => menuGridRef.current?.scrollBy({ top: -320, behavior: "smooth" })}>
                ▲ Lên
              </button>
              <button type="button" aria-label="Cuộn danh sách món xuống"
                onClick={() => menuGridRef.current?.scrollBy({ top: 320, behavior: "smooth" })}>
                ▼ Xuống
              </button>
            </div>
          </section>

          <section className="pos-cart-side">
            <div className="pos-cart-head">
              <div>
                <strong>
                  {selectedTable
                    ? `${selectedTable.area_name} · ${selectedTable.name}`
                    : "Chọn bàn"}
                </strong>
                <small>
                  {editingOrder
                    ? `${editingOrder.order_code} · Đang phục vụ`
                    : "Order mới"}
                </small>
              </div>
              <span className="pos-cart-status">Chưa thanh toán</span>
            </div>
            <div className="pos-cart-columns">
              <b>Tên món</b>
              <b>SL</b>
              <b>Thành tiền</b>
            </div>
            <div className="pos-cart-lines">
              {cart.map((line) => {
                const expanded = selectedLineKey === line.key;
                return (
                  <div className={`pos-cart-line${expanded ? " expanded" : ""}`} key={line.key}>
                    <div className="pos-line-name">
                      <button
                        type="button"
                        className="pos-line-toggle"
                        aria-expanded={expanded}
                        onClick={() => setSelectedLineKey((current) =>
                          current === line.key ? null : line.key
                        )}
                      >
                        <strong>{line.name}</strong>
                        {line.optionName && <em>+ {line.optionName}</em>}
                      </button>
                      {expanded && (
                        <div className="pos-line-details">
                          {line.surcharges.map((extra, index) => (
                            <div className="pos-line-extra" key={index}>
                              <span>+ {extra.name}: {money(extra.amount)} đ</span>
                              <button
                                type="button"
                                aria-label={`Bỏ phụ thu ${extra.name}`}
                                onClick={() => removeLineSurcharge(line.key, index)}
                              >×</button>
                            </div>
                          ))}
                          {line.note && <small className="pos-line-note">{line.note}</small>}
                          <div className="pos-line-tools">
                            <button type="button" onClick={() => openSurcharge(line.key)}>
                              + Phụ thu
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setNoteLineKey(line.key);
                                setNoteDraft(line.note);
                              }}
                            >
                              {line.note ? "Sửa ghi chú" : "+ Ghi chú"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="pos-line-qty">
                      <button type="button" aria-label="Giảm số lượng"
                        onClick={() => updateQuantity(line.key, line.quantity - 1)}>−</button>
                      <InputNumber<number> min={0.01} step={1} value={line.quantity}
                        onChange={(value) => {
                          if (value !== null) updateQuantity(line.key, value);
                        }}
                      />
                      <button type="button" aria-label="Tăng số lượng"
                        onClick={() => updateQuantity(line.key, line.quantity + 1)}>+</button>
                    </div>
                    <strong>{money(rowTotal(line))}</strong>
                    <button type="button" className="pos-line-remove" title="Bỏ món"
                      onClick={() => updateQuantity(line.key, 0)}>×</button>
                  </div>
                );
              })}
              {!cart.length && (
                <div className="pos-empty">
                  Chọn món ở phần thực đơn bên trái để lập Order.
                </div>
              )}
            </div>
            <div className="pos-cart-bottom">
              <div className="pos-total">
                <span>Tổng tiền</span>
                <strong>{money(total)} đ</strong>
              </div>
              <div className="pos-create-actions">
                <Button className="pos-kitchen-button" disabled={busy || !cart.length}
                  loading={busy} onClick={sendKitchen}>Gửi bếp</Button>
                <Button danger disabled={busy} onClick={backToMap}>Huỷ</Button>
                <Button className="pos-save-order" disabled={!cart.length} loading={busy}
                  onClick={() => void saveOrder()}>Lưu</Button>
                <Button className="pos-pay-button" type="primary" disabled={!cart.length || busy}
                  onClick={openPayment}>Tính tiền</Button>
              </div>
            </div>
          </section>
        </main>
      )}

      <Modal
        open={optionItem !== null}
        title={optionItem ? `Chọn kiểu chế biến · ${optionItem.name}` : ""}
        footer={null}
        onCancel={() => setOptionItem(null)}
        destroyOnClose
      >
        <div className="pos-option-list">
          {optionItem?.options
            .filter((option) => option.is_active)
            .map((option) => (
              <Button
                key={option.id}
                onClick={() => addItem(optionItem, option)}
              >
                <span>{option.service_option_name}</span>
                <strong>{money(option.sale_price)} đ</strong>
              </Button>
            ))}
        </div>
      </Modal>

      <Modal
        open={noteLineKey !== null}
        title="Ghi chú món"
        okText="Xong"
        cancelText="Hủy"
        onCancel={() => setNoteLineKey(null)}
        onOk={() => {
          setCart((current) =>
            current.map((line) =>
              line.key === noteLineKey
                ? { ...line, note: noteDraft.trim() }
                : line
            )
          );
          setDirty(true);
          setNoteLineKey(null);
        }}
      >
        <Input.TextArea
          rows={3}
          maxLength={300}
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="Ví dụ: ít cay, không hành..."
        />
      </Modal>
    </div>
  );
}
