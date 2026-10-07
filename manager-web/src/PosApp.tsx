import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space
} from "antd";
import {
  createSaleOrder,
  getFundAccounts,
  getMenuItems,
  getRestaurantAreas,
  getRestaurantTables,
  getSaleOrders,
  paySaleOrder,
  sendSaleOrderToKitchen,
  updateSaleOrder
} from "./api";
import type {
  FundAccount,
  MenuItem,
  MenuItemOption,
  RestaurantArea,
  RestaurantTable,
  SaleOrder,
  SaleOrderInput,
  SaleSurchargeInput
} from "./types";
import "./PosApp.css";

type PosView = "ORDERS" | "MAP" | "SALE";
type CartLine = {
  key: string;
  menu_item_id: number;
  menu_item_option_id: number | null;
  item_name: string;
  option_name: string | null;
  unit_price: number;
  quantity: number;
  note: string;
  surcharges: SaleSurchargeInput[];
};
type OrderSurcharge = SaleSurchargeInput & { key: string };

let surchargeSequence = 0;

function money(value: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(value));
}

function lineKey(itemId: number, optionId: number | null) {
  return `${itemId}:${optionId ?? "base"}`;
}

function formatDuration(value: string | null) {
  if (!value) return "";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return `${minutes}p`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? String(rest).padStart(2, "0") : ""}`;
}

export default function PosApp() {
  const [view, setView] = useState<PosView>("ORDERS");
  const [areas, setAreas] = useState<RestaurantArea[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [funds, setFunds] = useState<FundAccount[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [orderFilter, setOrderFilter] = useState<"DINE_IN" | "TAKEAWAY">("DINE_IN");
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState<number | "ALL">("ALL");
  const [currentOrder, setCurrentOrder] = useState<SaleOrder | null>(null);
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY">("TAKEAWAY");
  const [tableId, setTableId] = useState<number | null>(null);
  const [guestCount, setGuestCount] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderSurcharges, setOrderSurcharges] = useState<OrderSurcharge[]>([]);
  const [optionItem, setOptionItem] = useState<MenuItem | null>(null);
  const [noteLineKey, setNoteLineKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [surchargeOpen, setSurchargeOpen] = useState(false);
  const [surchargeName, setSurchargeName] = useState("");
  const [surchargeAmount, setSurchargeAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<SaleOrder | null>(null);
  const [fundId, setFundId] = useState<number | null>(null);
  const [received, setReceived] = useState(0);
  const [messageApi, contextHolder] = message.useMessage();

  async function load() {
    const [areaRows, tableRows, orderRows, menuRows, fundRows] = await Promise.all([
      getRestaurantAreas(true),
      getRestaurantTables({ active_only: true }),
      getSaleOrders({ status: "OPEN" }),
      getMenuItems(),
      getFundAccounts()
    ]);
    setAreas(areaRows);
    setTables(tableRows);
    setOrders(orderRows);
    setMenuItems(menuRows.filter((row) => row.is_active));
    setFunds(fundRows.filter((row) => row.is_active));
    setSelectedAreaId((current) =>
      current ?? (areaRows.length ? areaRows[0].id : null)
    );
    setFundId((current) => {
      if (current !== null) return current;
      const preferred =
        fundRows.find((row) => row.is_active && row.type === "CASH" && row.is_default) ??
        fundRows.find((row) => row.is_active && row.type === "CASH") ??
        fundRows.find((row) => row.is_active);
      return preferred?.id ?? null;
    });
  }

  useEffect(() => {
    void load().catch((error) =>
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được dữ liệu POS."
      )
    );
  }, []);

  const groups = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of menuItems) {
      map.set(item.menu_group_id, item.menu_group_name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [menuItems]);

  const visibleMenu = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("vi");
    return menuItems
      .filter((item) => groupId === "ALL" || item.menu_group_id === groupId)
      .filter(
        (item) =>
          !needle || item.name.toLocaleLowerCase("vi").includes(needle)
      )
      .sort((a, b) => a.display_order - b.display_order || a.id - b.id);
  }, [menuItems, groupId, search]);

  const total = useMemo(
    () =>
      cart.reduce(
        (sum, line) =>
          sum +
          line.unit_price * line.quantity +
          line.surcharges.reduce((sub, row) => sub + row.amount, 0),
        0
      ) + orderSurcharges.reduce((sum, row) => sum + row.amount, 0),
    [cart, orderSurcharges]
  );

  function resetSale(
    type: "DINE_IN" | "TAKEAWAY",
    selectedTableId: number | null = null
  ) {
    setCurrentOrder(null);
    setOrderType(type);
    setTableId(selectedTableId);
    setGuestCount(0);
    setCart([]);
    setOrderSurcharges([]);
    setSearch("");
    setGroupId("ALL");
    setView("SALE");
  }

  function openOrder(order: SaleOrder) {
    setCurrentOrder(order);
    setOrderType(order.order_type);
    setTableId(order.table_id);
    setGuestCount(order.guest_count);
    setCart(
      order.items
        .filter((item) => item.menu_item_id !== null)
        .map((item) => ({
          key: lineKey(item.menu_item_id as number, item.menu_item_option_id),
          menu_item_id: item.menu_item_id as number,
          menu_item_option_id: item.menu_item_option_id,
          item_name: item.item_name_snapshot,
          option_name: item.option_name_snapshot,
          unit_price: item.unit_price,
          quantity: item.quantity,
          note: item.note ?? "",
          surcharges: item.surcharges.map((row) => ({
            name: row.name,
            amount: row.amount
          }))
        }))
    );
    setOrderSurcharges(
      order.surcharges.map((row) => ({
        key: `saved-${row.id}`,
        name: row.name,
        amount: row.amount
      }))
    );
    setView("SALE");
  }

  function openTable(table: RestaurantTable) {
    const order =
      orders.find((row) => row.id === table.open_order_id) ??
      orders.find((row) => row.table_id === table.id);
    if (order) {
      openOrder(order);
    } else {
      resetSale("DINE_IN", table.id);
    }
  }

  function addLine(item: MenuItem, option?: MenuItemOption) {
    const optionId = option?.id ?? null;
    const key = lineKey(item.id, optionId);
    const price = option?.sale_price ?? item.base_price;
    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key
            ? { ...line, quantity: line.quantity + 1 }
            : line
        );
      }
      return [
        ...current,
        {
          key,
          menu_item_id: item.id,
          menu_item_option_id: optionId,
          item_name: item.name,
          option_name: option?.service_option_name ?? null,
          unit_price: price,
          quantity: 1,
          note: "",
          surcharges: []
        }
      ];
    });
    setOptionItem(null);
  }

  function chooseMenu(item: MenuItem) {
    const options = item.options.filter((row) => row.is_active);
    if (options.length) {
      setOptionItem(item);
    } else {
      addLine(item);
    }
  }

  function changeQty(key: string, next: number) {
    setCart((current) =>
      next <= 0
        ? current.filter((line) => line.key !== key)
        : current.map((line) =>
            line.key === key ? { ...line, quantity: next } : line
          )
    );
  }

  function buildPayload(): SaleOrderInput {
    return {
      order_time: currentOrder?.order_time ?? new Date().toISOString(),
      order_type: orderType,
      table_id: orderType === "DINE_IN" ? tableId : null,
      guest_count: guestCount,
      customer_id: currentOrder?.customer_id ?? null,
      note: currentOrder?.note ?? null,
      items: cart.map((line) => ({
        menu_item_id: line.menu_item_id,
        menu_item_option_id: line.menu_item_option_id,
        quantity: line.quantity,
        note: line.note || null,
        surcharges: line.surcharges
      })),
      surcharges: orderSurcharges.map(({ name, amount }) => ({
        name,
        amount
      }))
    };
  }

  async function persist(): Promise<SaleOrder> {
    if (!cart.length) throw new Error("Đơn chưa có món.");
    if (orderType === "DINE_IN" && !tableId) {
      throw new Error("Chọn bàn trước khi lưu.");
    }

    setSaving(true);
    try {
      const saved = currentOrder
        ? await updateSaleOrder(currentOrder.id, buildPayload())
        : await createSaleOrder(buildPayload());
      setCurrentOrder(saved);
      await load();
      return saved;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndReturn() {
    try {
      const saved = await persist();
      messageApi.success(`Đã lưu ${saved.order_code}.`);
      setView(orderType === "DINE_IN" ? "MAP" : "ORDERS");
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được đơn."
      );
    }
  }

  async function saveAndAdd() {
    try {
      const saved = await persist();
      messageApi.success(`Đã lưu ${saved.order_code}.`);
      resetSale("TAKEAWAY");
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được đơn."
      );
    }
  }

  async function sendKitchen() {
    try {
      const saved = await persist();
      const result = await sendSaleOrderToKitchen(saved.id);
      if (result.print_status === "PRINTED") {
        messageApi.success(`Đã gửi ${saved.order_code} xuống bếp.`);
        setCurrentOrder({ ...saved, kitchen_sent_at: result.sent_at });
        await load();
      } else {
        messageApi.error(
          result.error_message ||
            "Đơn đã lưu nhưng chưa in được phiếu bếp. Kiểm tra Cài đặt > Máy in bếp."
        );
      }
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không gửi được bếp."
      );
    }
  }

  async function beginPayment() {
    try {
      const saved = await persist();
      setPaymentOrder(saved);
      setReceived(saved.total_amount);
      setPaymentOpen(true);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được đơn."
      );
    }
  }

  async function confirmPayment() {
    if (!paymentOrder || !fundId) {
      messageApi.warning("Chọn quỹ/tài khoản nhận tiền.");
      return;
    }
    setSaving(true);
    try {
      const paid = await paySaleOrder(paymentOrder.id, {
        fund_account_id: fundId,
        actual_received_amount: Math.round(received)
      });
      messageApi.success(`Đã thanh toán ${paid.order_code}.`);
      setPaymentOpen(false);
      setPaymentOrder(null);
      setCurrentOrder(null);
      setCart([]);
      setOrderSurcharges([]);
      await load();
      setView("ORDERS");
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không thanh toán được."
      );
    } finally {
      setSaving(false);
    }
  }

  const orderCards = orders.filter((row) => row.order_type === orderFilter);
  const areaTables = tables.filter((row) => row.area_id === selectedAreaId);

  return (
    <div className="oc11-pos">
      {contextHolder}
      <header className="pos-topbar">
        <button className="pos-home" onClick={() => setView("ORDERS")}>
          ⌂
        </button>
        <button
          className={view === "ORDERS" ? "active" : ""}
          onClick={() => setView("ORDERS")}
        >
          🧾 Order
        </button>
        <button
          className={view === "MAP" ? "active" : ""}
          onClick={() => setView("MAP")}
        >
          ▥ Sơ đồ
        </button>
        <div className="pos-topbar-spacer" />
        <button className="pos-new-order" onClick={() => resetSale("TAKEAWAY")}>
          ＋ ORDER
        </button>
        <div className="pos-brand">ỐC 11 POS</div>
      </header>

      {view === "MAP" && (
        <main className="pos-map-view">
          <div className="pos-map-summary">
            <strong>Toàn bộ nhà hàng:</strong>
            <span>
              Trống {tables.filter((row) => !row.open_order_id).length}/
              {tables.length} bàn
            </span>
            <span className="pos-legend">
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
                    className={selectedAreaId === area.id ? "active" : ""}
                    onClick={() => setSelectedAreaId(area.id)}
                  >
                    <b>{area.name}</b>
                    <span>
                      {empty}/{rows.length} trống
                    </span>
                  </button>
                );
              })}
            </aside>
            <section className="pos-table-map">
              {areaTables.map((table) => (
                <button
                  key={table.id}
                  className={`pos-table ${table.open_order_id ? "busy" : "empty"}`}
                  onClick={() => openTable(table)}
                >
                  <span className="table-icon">▣</span>
                  <strong>{table.name}</strong>
                  {table.open_order_id ? (
                    <>
                      <small>{money(table.open_order_total ?? 0)} đ</small>
                      <small>{formatDuration(table.open_order_time)}</small>
                    </>
                  ) : (
                    <small>{table.seats ? `${table.seats} ghế` : "Trống"}</small>
                  )}
                </button>
              ))}
              {!areaTables.length && (
                <div className="pos-empty">Khu vực này chưa có bàn.</div>
              )}
            </section>
          </div>
        </main>
      )}

      {view === "ORDERS" && (
        <main className="pos-order-view">
          <div className="pos-order-tabs">
            <button
              className={orderFilter === "DINE_IN" ? "active" : ""}
              onClick={() => setOrderFilter("DINE_IN")}
            >
              Chờ thanh toán (
              {orders.filter((row) => row.order_type === "DINE_IN").length})
            </button>
            <button
              className={orderFilter === "TAKEAWAY" ? "active" : ""}
              onClick={() => setOrderFilter("TAKEAWAY")}
            >
              Mang về (
              {orders.filter((row) => row.order_type === "TAKEAWAY").length})
            </button>
          </div>
          <section className="pos-order-grid">
            {orderCards.map((order) => (
              <button
                key={order.id}
                className="pos-order-card"
                onClick={() => openOrder(order)}
              >
                <div className="order-card-head">
                  <strong>
                    {order.order_type === "DINE_IN"
                      ? `${order.area_name ?? ""} - ${order.table_name ?? ""}`
                      : order.order_code}
                  </strong>
                  <span>👤 {order.guest_count || 0}</span>
                </div>
                <div className="order-card-body">
                  <b>
                    {order.items.reduce((sum, row) => sum + row.quantity, 0)}
                  </b>
                  <div>
                    <strong>{money(order.total_amount)} đ</strong>
                    <small>◷ {formatDuration(order.order_time)}</small>
                  </div>
                </div>
                <div className="order-card-foot">
                  {order.kitchen_sent_at ? "✓ Đã gửi bếp" : "Chưa gửi bếp"}
                </div>
              </button>
            ))}
            {!orderCards.length && (
              <div className="pos-empty">Không có order đang chờ.</div>
            )}
          </section>
        </main>
      )}

      {view === "SALE" && (
        <main className="pos-sale-view">
          <section className="pos-menu-side">
            <div className="pos-group-tabs">
              <button
                className={groupId === "ALL" ? "active" : ""}
                onClick={() => setGroupId("ALL")}
              >
                Hay dùng
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
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm món..."
                allowClear
              />
            </div>
            <div className="pos-menu-grid">
              {visibleMenu.map((item) => {
                const options = item.options.filter((row) => row.is_active);
                const price = options.length
                  ? Math.min(...options.map((row) => row.sale_price))
                  : item.base_price;
                return (
                  <button
                    key={item.id}
                    className="pos-menu-item"
                    onClick={() => chooseMenu(item)}
                  >
                    <span className="item-price">{money(price)}</span>
                    <strong>{item.name}</strong>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="pos-cart-side">
            <div className="pos-cart-head">
              <div>
                <strong>
                  {currentOrder?.order_code ??
                    (orderType === "DINE_IN" ? "Order tại bàn" : "Order mang về")}
                </strong>
                {currentOrder?.kitchen_sent_at && <small>✓ Đã gửi bếp</small>}
              </div>
              <Select
                value={orderType}
                onChange={(value: "DINE_IN" | "TAKEAWAY") => {
                  setOrderType(value);
                  if (value === "TAKEAWAY") setTableId(null);
                }}
                options={[
                  { value: "DINE_IN", label: "Tại bàn" },
                  { value: "TAKEAWAY", label: "Mang về" }
                ]}
                style={{ width: 130 }}
              />
              {orderType === "DINE_IN" && (
                <Select
                  value={tableId ?? undefined}
                  onChange={(value: number) => setTableId(value)}
                  placeholder="Chọn bàn"
                  style={{ minWidth: 130 }}
                  options={tables.map((row) => ({
                    value: row.id,
                    label: `${row.area_name} - ${row.name}`,
                    disabled:
                      row.open_order_id !== null &&
                      row.open_order_id !== currentOrder?.id
                  }))}
                />
              )}
              <div className="pos-guest">
                👤
                <InputNumber<number>
                  min={0}
                  value={guestCount}
                  onChange={(value) => setGuestCount(Number(value ?? 0))}
                />
              </div>
            </div>

            <div className="pos-cart-columns">
              <b>Tên món</b>
              <b>SL</b>
              <b>Thành tiền</b>
            </div>
            <div className="pos-cart-lines">
              {cart.map((line) => (
                <div className="pos-cart-line" key={line.key}>
                  <div className="pos-line-name">
                    <strong>{line.item_name}</strong>
                    {line.option_name && <em>+ {line.option_name}</em>}
                    {line.surcharges.map((row, index) => (
                      <small key={`${row.name}-${index}`}>
                        + {row.name}: {money(row.amount)} đ
                      </small>
                    ))}
                    {line.note && <small>* {line.note}</small>}
                    <button
                      onClick={() => {
                        setNoteLineKey(line.key);
                        setNoteDraft(line.note);
                      }}
                    >
                      Ghi chú
                    </button>
                  </div>
                  <div className="pos-line-qty">
                    <button
                      onClick={() => changeQty(line.key, line.quantity - 1)}
                    >
                      −
                    </button>
                    <InputNumber<number>
                      min={0.001}
                      value={line.quantity}
                      onChange={(value) =>
                        changeQty(line.key, Number(value ?? 1))
                      }
                    />
                    <button
                      onClick={() => changeQty(line.key, line.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                  <strong>
                    {money(
                      line.unit_price * line.quantity +
                        line.surcharges.reduce((sum, row) => sum + row.amount, 0)
                    )}
                  </strong>
                  <button
                    className="pos-line-remove"
                    onClick={() => changeQty(line.key, 0)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {!cart.length && (
                <div className="pos-empty">Chọn món ở bên trái.</div>
              )}
            </div>

            <div className="pos-cart-bottom">
              <div className="pos-surcharge-block">
                <Button
                  type="link"
                  onClick={() => {
                    setSurchargeName("");
                    setSurchargeAmount(0);
                    setSurchargeOpen(true);
                  }}
                >
                  ＋ Thêm món khác / phụ thu
                </Button>
                {orderSurcharges.map((row) => (
                  <span key={row.key}>
                    + {row.name}: {money(row.amount)} đ
                    <button
                      onClick={() =>
                        setOrderSurcharges((current) =>
                          current.filter((item) => item.key !== row.key)
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="pos-total">
                <span>Tổng tiền</span>
                <strong>{money(total)} đ</strong>
              </div>
              <div className="pos-actions">
                <Button size="large" onClick={() => setView("ORDERS")}>
                  Đóng
                </Button>
                <Button
                  size="large"
                  loading={saving}
                  onClick={() => void saveAndReturn()}
                >
                  Lưu
                </Button>
                <Button
                  size="large"
                  loading={saving}
                  onClick={() => void saveAndAdd()}
                >
                  Lưu & Thêm
                </Button>
                <Button
                  size="large"
                  className="pos-kitchen-button"
                  loading={saving}
                  onClick={() => void sendKitchen()}
                >
                  Gửi bếp
                </Button>
                <Button
                  type="primary"
                  size="large"
                  className="pos-pay-button"
                  loading={saving}
                  onClick={() => void beginPayment()}
                >
                  Tính tiền
                </Button>
              </div>
            </div>
          </section>
        </main>
      )}

      <Modal
        open={optionItem !== null}
        title={optionItem ? `Chọn kiểu chế biến - ${optionItem.name}` : ""}
        footer={null}
        onCancel={() => setOptionItem(null)}
      >
        <div className="pos-option-list">
          {optionItem?.options
            .filter((row) => row.is_active)
            .map((option) => (
              <Button key={option.id} onClick={() => addLine(optionItem, option)}>
                <span>{option.service_option_name}</span>
                <strong>{money(option.sale_price)} đ</strong>
              </Button>
            ))}
        </div>
      </Modal>

      <Modal
        open={noteLineKey !== null}
        title="Ghi chú món"
        okText="Lưu ghi chú"
        onCancel={() => setNoteLineKey(null)}
        onOk={() => {
          if (noteLineKey) {
            setCart((current) =>
              current.map((line) =>
                line.key === noteLineKey
                  ? { ...line, note: noteDraft.trim() }
                  : line
              )
            );
          }
          setNoteLineKey(null);
        }}
      >
        <Input.TextArea
          autoFocus
          rows={3}
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="VD: ít cay, không hành..."
        />
      </Modal>

      <Modal
        open={surchargeOpen}
        title="Thêm món khác / phụ thu"
        okText="Thêm"
        onCancel={() => setSurchargeOpen(false)}
        onOk={() => {
          if (!surchargeName.trim() || surchargeAmount <= 0) {
            messageApi.warning("Nhập tên và số tiền phụ thu.");
            return;
          }
          surchargeSequence += 1;
          setOrderSurcharges((current) => [
            ...current,
            {
              key: `extra-${surchargeSequence}`,
              name: surchargeName.trim(),
              amount: Math.round(surchargeAmount)
            }
          ]);
          setSurchargeOpen(false);
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            autoFocus
            value={surchargeName}
            onChange={(event) => setSurchargeName(event.target.value)}
            placeholder="Tên phụ thu / món khác"
          />
          <InputNumber<number>
            min={1}
            precision={0}
            value={surchargeAmount}
            onChange={(value) => setSurchargeAmount(Number(value ?? 0))}
            addonAfter="đ"
            style={{ width: "100%" }}
          />
        </Space>
      </Modal>

      <Modal
        open={paymentOpen}
        title={
          paymentOrder
            ? `Thanh toán ${paymentOrder.order_code}`
            : "Thanh toán"
        }
        okText="Xác nhận thanh toán"
        confirmLoading={saving}
        onCancel={() => setPaymentOpen(false)}
        onOk={() => void confirmPayment()}
      >
        <div className="pos-payment-modal">
          <div>
            <span>Tổng hóa đơn</span>
            <strong>{money(paymentOrder?.total_amount ?? total)} đ</strong>
          </div>
          <label>
            <span>Quỹ / tài khoản nhận tiền</span>
            <Select
              value={fundId ?? undefined}
              onChange={(value: number) => setFundId(value)}
              options={funds.map((row) => ({
                value: row.id,
                label: `${row.type === "CASH" ? "Tiền mặt" : "Chuyển khoản"} - ${row.name}`
              }))}
            />
          </label>
          <label>
            <span>Tiền thực thu</span>
            <InputNumber<number>
              min={0}
              precision={0}
              value={received}
              onChange={(value) => setReceived(Number(value ?? 0))}
              addonAfter="đ"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
