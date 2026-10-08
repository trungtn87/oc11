import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from "antd";
import type { TableProps } from "antd";

import {
  createSaleOrder,
  createSurchargePreset,
  getFundAccounts,
  getMenuItems,
  getSaleOrders,
  getSurchargePresets,
  paySaleOrder,
  updateSaleOrder,
  voidSaleOrder
} from "./api";
import type {
  FundAccount,
  FundAccountType,
  MenuItem,
  MenuItemOption,
  SaleOrder,
  SurchargePreset
} from "./types";

const { Title, Text } = Typography;

type CartSurcharge = {
  key: string;
  name: string;
  amount: number;
};

type CartLine = {
  key: string;
  menu_item_id: number;
  menu_item_option_id: number | null;
  item_name: string;
  option_name: string | null;
  unit_name: string;
  quantity: number;
  unit_price: number;
  surcharges: CartSurcharge[];
};

let surchargeSequence = 0;

function nextSurchargeKey() {
  surchargeSequence += 1;
  return `surcharge-${surchargeSequence}`;
}

function surchargeTotal(surcharges: CartSurcharge[]) {
  return surcharges.reduce((sum, surcharge) => sum + surcharge.amount, 0);
}

function money(value: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(value));
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function cartKey(menuItemId: number, optionId: number | null) {
  return `${menuItemId}:${optionId ?? "base"}`;
}

type SalesPeriod =
  | "TODAY"
  | "YESTERDAY"
  | "MONTH"
  | "QUARTER"
  | "YEAR"
  | "CUSTOM";

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function periodRange(
  period: SalesPeriod,
  customFrom = "",
  customTo = ""
): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === "CUSTOM") {
    return { from: customFrom, to: customTo };
  }

  let from = new Date(today);
  let to = new Date(today);

  if (period === "YESTERDAY") {
    from.setDate(from.getDate() - 1);
    to = new Date(from);
  } else if (period === "MONTH") {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
  } else if (period === "QUARTER") {
    const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
    from = new Date(today.getFullYear(), quarterStartMonth, 1);
  } else if (period === "YEAR") {
    from = new Date(today.getFullYear(), 0, 1);
  }

  return { from: dateKey(from), to: dateKey(to) };
}

function toLocalDateTimeInput(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function periodLabel(period: SalesPeriod) {
  if (period === "TODAY") return "Hôm nay";
  if (period === "YESTERDAY") return "Hôm qua";
  if (period === "MONTH") return "Tháng này";
  if (period === "QUARTER") return "Quý này";
  if (period === "YEAR") return "Năm nay";
  return "Tùy chọn";
}

export function SalesPosPage({
  onOpenOrders,
  editingOrder,
  onEditDone
}: {
  onOpenOrders?: () => void;
  editingOrder?: SaleOrder | null;
  onEditDone?: () => void;
}) {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [surchargePresets, setSurchargePresets] = useState<SurchargePreset[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string>("ALL");
  const [accountType, setAccountType] = useState<FundAccountType>("CASH");
  const [fundAccountId, setFundAccountId] = useState<number>();
  const [actualReceived, setActualReceived] = useState<number>(0);
  const [actualTouched, setActualTouched] = useState(false);
  const [editPaymentStatus, setEditPaymentStatus] =
    useState<"PAID" | "DEBT">("DEBT");
  const [optionItem, setOptionItem] = useState<MenuItem | null>(null);
  const [orderSurcharges, setOrderSurcharges] = useState<CartSurcharge[]>([]);
  const [surchargeTarget, setSurchargeTarget] = useState<
    { type: "ITEM"; lineKey: string } | { type: "ORDER" } | null
  >(null);
  const [surchargeName, setSurchargeName] = useState("");
  const [surchargeAmount, setSurchargeAmount] = useState<number>(0);
  const [surchargePresetId, setSurchargePresetId] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedEditOrderId, setLoadedEditOrderId] = useState<number | null>(null);
  const [orderTimeLocal, setOrderTimeLocal] = useState(() =>
    toLocalDateTimeInput(new Date())
  );
  const [messageApi, messageContext] = message.useMessage();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [menu, funds, presets] = await Promise.all([
          getMenuItems(),
          getFundAccounts(),
          getSurchargePresets()
        ]);
        if (cancelled) return;
        setMenuItems(menu.filter((item) => item.is_active));
        setAccounts(funds);
        setSurchargePresets(presets);
        const preferred =
          funds.find(
            (account) =>
              account.is_active &&
              account.type === "CASH" &&
              account.is_default
          ) ??
          funds.find(
            (account) => account.is_active && account.type === "CASH"
          ) ??
          funds.find((account) => account.is_active);
        if (preferred) {
          setAccountType(preferred.type);
          setFundAccountId(preferred.id);
        }
      } catch (error) {
        messageApi.error(
          error instanceof Error ? error.message : "Không tải được dữ liệu bán hàng."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      !editingOrder ||
      accounts.length === 0 ||
      loadedEditOrderId === editingOrder.id
    ) {
      return;
    }

    if (!editingOrder.can_edit) {
      messageApi.error("Đơn đã phát hành hóa đơn điện tử hoặc đã xóa.");
      onEditDone?.();
      return;
    }

    const missingMenuItem = editingOrder.items.find(
      (item) => item.menu_item_id === null
    );
    if (missingMenuItem) {
      messageApi.error(
        "Đơn có món đã bị xóa khỏi thực đơn nên không thể sửa trực tiếp."
      );
      onEditDone?.();
      return;
    }

    setCart(
      editingOrder.items.map((item) => ({
        key: cartKey(item.menu_item_id as number, item.menu_item_option_id),
        menu_item_id: item.menu_item_id as number,
        menu_item_option_id: item.menu_item_option_id,
        item_name: item.item_name_snapshot,
        option_name: item.option_name_snapshot,
        unit_name: item.unit_name_snapshot,
        quantity: item.quantity,
        unit_price: item.unit_price,
        surcharges: item.surcharges.map((surcharge) => ({
          key: `saved-item-surcharge-${surcharge.id}`,
          name: surcharge.name,
          amount: surcharge.amount
        }))
      }))
    );
    setOrderSurcharges(
      editingOrder.surcharges.map((surcharge) => ({
        key: `saved-order-surcharge-${surcharge.id}`,
        name: surcharge.name,
        amount: surcharge.amount
      }))
    );

    const paidAccount = accounts.find(
      (account) => account.id === editingOrder.fund_account_id
    );
    if (paidAccount) {
      setAccountType(paidAccount.type);
      setFundAccountId(paidAccount.id);
    }

    setEditPaymentStatus(
      editingOrder.status === "PAID" && editingOrder.settlement_status === "PAID" ? "PAID" : "DEBT"
    );
    setActualReceived(
      editingOrder.actual_received_amount ?? editingOrder.total_amount
    );
    setActualTouched(editingOrder.status === "PAID" && editingOrder.settlement_status === "PAID");
    setOrderTimeLocal(toLocalDateTimeInput(editingOrder.order_time));
    setLoadedEditOrderId(editingOrder.id);
  }, [
    accounts,
    editingOrder,
    loadedEditOrderId,
    messageApi,
    onEditDone
  ]);

  useEffect(() => {
    if (editingOrder || loadedEditOrderId === null) return;

    setCart([]);
    setOrderSurcharges([]);
    setSurchargeTarget(null);
    setSurchargePresetId(undefined);
    setSurchargeName("");
    setSurchargeAmount(0);
    setActualTouched(false);
    setActualReceived(0);
    setEditPaymentStatus("DEBT");
    setOrderTimeLocal(toLocalDateTimeInput(new Date()));

    const preferred =
      accounts.find(
        (account) =>
          account.is_active &&
          account.type === "CASH" &&
          account.is_default
      ) ??
      accounts.find(
        (account) => account.is_active && account.type === "CASH"
      ) ??
      accounts.find((account) => account.is_active);
    if (preferred) {
      setAccountType(preferred.type);
      setFundAccountId(preferred.id);
    } else {
      setFundAccountId(undefined);
    }

    setLoadedEditOrderId(null);
  }, [accounts, editingOrder, loadedEditOrderId]);

  const groups = useMemo(
    () =>
      Array.from(
        new Set(menuItems.map((item) => item.menu_group_name))
      ).sort((a, b) => a.localeCompare(b, "vi")),
    [menuItems]
  );

  const visibleMenu = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");
    return menuItems.filter((item) => {
      if (group !== "ALL" && item.menu_group_name !== group) return false;
      if (!keyword) return true;
      return (
        item.name.toLocaleLowerCase("vi").includes(keyword) ||
        item.menu_group_name.toLocaleLowerCase("vi").includes(keyword)
      );
    });
  }, [menuItems, group, search]);

  const activeAccounts = useMemo(
    () =>
      accounts.filter(
        (account) => account.is_active && account.type === accountType
      ),
    [accounts, accountType]
  );

  const total = useMemo(
    () =>
      cart.reduce(
        (sum, line) =>
          sum +
          line.quantity * line.unit_price +
          surchargeTotal(line.surcharges),
        0
      ) + surchargeTotal(orderSurcharges),
    [cart, orderSurcharges]
  );

  useEffect(() => {
    if (!actualTouched) setActualReceived(Math.round(total));
  }, [total, actualTouched]);

  const addLine = (item: MenuItem, option: MenuItemOption | null) => {
    const key = cartKey(item.id, option?.id ?? null);
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
          menu_item_option_id: option?.id ?? null,
          item_name: item.name,
          option_name: option?.service_option_name ?? null,
          unit_name: item.sale_unit_name,
          quantity: 1,
          unit_price: option?.sale_price ?? item.base_price,
          surcharges: []
        }
      ];
    });
    setOptionItem(null);
  };

  const chooseItem = (item: MenuItem) => {
    const options = item.options.filter((option) => option.is_active);
    if (options.length) {
      setOptionItem(item);
      return;
    }
    addLine(item, null);
  };

  const changeQuantity = (key: string, quantity: number) => {
    if (quantity <= 0) {
      setCart((current) => current.filter((line) => line.key !== key));
      return;
    }
    setCart((current) =>
      current.map((line) =>
        line.key === key ? { ...line, quantity } : line
      )
    );
  };

  const openItemSurcharge = (lineKey: string) => {
    setSurchargePresetId(undefined);
    setSurchargeName("");
    setSurchargeAmount(0);
    setSurchargeTarget({ type: "ITEM", lineKey });
  };

  const openOrderSurcharge = () => {
    setSurchargePresetId(undefined);
    setSurchargeName("");
    setSurchargeAmount(0);
    setSurchargeTarget({ type: "ORDER" });
  };

  const selectSurchargePreset = (presetId: number | undefined) => {
    setSurchargePresetId(presetId);
    const preset = surchargePresets.find((item) => item.id === presetId);
    if (preset) {
      setSurchargeName(preset.name);
      setSurchargeAmount(preset.amount);
    }
  };

  const startNewSurcharge = () => {
    setSurchargePresetId(undefined);
    setSurchargeName("");
    setSurchargeAmount(0);
  };

  const addSurcharge = async () => {
    const name = surchargeName.trim();
    const amount = Math.round(Number(surchargeAmount || 0));
    if (!name) {
      messageApi.warning("Nhập tên phụ thu.");
      return;
    }
    if (amount <= 0) {
      messageApi.warning("Số tiền phụ thu phải lớn hơn 0.");
      return;
    }

    const knownPreset = surchargePresets.find(
      (item) => item.name.trim().toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi")
    );
    if (!knownPreset) {
      try {
        const saved = await createSurchargePreset({ name, amount });
        setSurchargePresets((current) => {
          const exists = current.some((item) => item.id === saved.id);
          return exists ? current : [...current, saved].sort((a, b) =>
            a.name.localeCompare(b.name, "vi")
          );
        });
      } catch (error) {
        messageApi.error(
          error instanceof Error ? error.message : "Không lưu được phụ thu dùng nhanh."
        );
        return;
      }
    }

    const surcharge: CartSurcharge = {
      key: nextSurchargeKey(),
      name,
      amount
    };

    if (surchargeTarget?.type === "ITEM") {
      setCart((current) =>
        current.map((line) =>
          line.key === surchargeTarget.lineKey
            ? { ...line, surcharges: [...line.surcharges, surcharge] }
            : line
        )
      );
    } else if (surchargeTarget?.type === "ORDER") {
      setOrderSurcharges((current) => [...current, surcharge]);
    }

    setSurchargeTarget(null);
    setSurchargePresetId(undefined);
    setSurchargeName("");
    setSurchargeAmount(0);
  };

  const removeItemSurcharge = (lineKey: string, surchargeKey: string) => {
    setCart((current) =>
      current.map((line) =>
        line.key === lineKey
          ? {
              ...line,
              surcharges: line.surcharges.filter(
                (surcharge) => surcharge.key !== surchargeKey
              )
            }
          : line
      )
    );
  };

  const removeOrderSurcharge = (surchargeKey: string) => {
    setOrderSurcharges((current) =>
      current.filter((surcharge) => surcharge.key !== surchargeKey)
    );
  };

  const changeAccountType = (nextType: FundAccountType) => {
    setAccountType(nextType);
    const preferred =
      accounts.find(
        (account) =>
          account.is_active &&
          account.type === nextType &&
          account.is_default
      ) ??
      accounts.find(
        (account) => account.is_active && account.type === nextType
      );
    setFundAccountId(preferred?.id);
  };

  const checkout = async (payNow: boolean) => {
    if (!cart.length) {
      messageApi.warning("Chưa có món trong đơn.");
      return;
    }

    const needsPaymentAccount =
      (editingOrder && editPaymentStatus === "PAID") ||
      (!editingOrder && payNow);
    if (needsPaymentAccount && !fundAccountId) {
      messageApi.warning("Chọn quỹ/tài khoản nhận tiền.");
      return;
    }

    const parsedOrderTime = new Date(orderTimeLocal);
    if (!orderTimeLocal || Number.isNaN(parsedOrderTime.getTime())) {
      messageApi.warning("Chọn thời gian hóa đơn hợp lệ.");
      return;
    }

    const orderPayload = {
      order_time: parsedOrderTime.toISOString(),
      customer_id: editingOrder?.customer_id ?? null,
      note: editingOrder?.note ?? null,
      items: cart.map((line) => ({
        menu_item_id: line.menu_item_id,
        menu_item_option_id: line.menu_item_option_id,
        quantity: line.quantity,
        surcharges: line.surcharges.map((surcharge) => ({
          name: surcharge.name,
          amount: surcharge.amount
        }))
      })),
      surcharges: orderSurcharges.map((surcharge) => ({
        name: surcharge.name,
        amount: surcharge.amount
      })),
      payment_status: editingOrder ? editPaymentStatus : null,
      fund_account_id:
        editingOrder && editPaymentStatus === "PAID"
          ? fundAccountId ?? null
          : null,
      actual_received_amount:
        editingOrder && editPaymentStatus === "PAID"
          ? Math.round(actualReceived)
          : null
    };

    setSaving(true);
    let created: SaleOrder | null = null;
    try {
      if (editingOrder) {
        const updated = await updateSaleOrder(editingOrder.id, orderPayload);
        messageApi.success(
          updated.status === "PAID"
            ? `Đã cập nhật ${updated.order_code}. Tiền và kho đã được cân lại tự động.`
            : `Đã cập nhật ${updated.order_code} thành nợ/chưa thanh toán. Tiền đã được đảo khỏi quỹ nếu trước đó đã thu.`
        );
        onEditDone?.();
        return;
      }

      created = await createSaleOrder(orderPayload);

      if (payNow) {
        const paid = await paySaleOrder(created.id, {
          fund_account_id: fundAccountId as number,
          actual_received_amount: Math.round(actualReceived)
        });
        messageApi.success(
          `Đã thanh toán ${paid.order_code}. Kho đã được trừ tự động.`
        );
      } else {
        messageApi.success(
          `Đã lưu ${created.order_code}. Kho đã trừ, đơn đang chờ thanh toán.`
        );
      }

      setCart([]);
      setOrderSurcharges([]);
      setActualTouched(false);
      setActualReceived(0);
      setOrderTimeLocal(toLocalDateTimeInput(new Date()));
    } catch (error) {
      if (created && payNow) {
        setCart([]);
        setOrderSurcharges([]);
        setActualTouched(false);
        setActualReceived(0);
        messageApi.error(
          error instanceof Error
            ? `Đã lưu ${created.order_code} nhưng chưa thanh toán: ${error.message}`
            : `Đã lưu ${created.order_code} nhưng chưa thanh toán. Có thể thanh toán lại trong danh sách đơn.`
        );
      } else {
        messageApi.error(
          error instanceof Error
            ? error.message
            : editingOrder
              ? "Không sửa được đơn bán."
              : "Không lưu được đơn bán."
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {messageContext}
      <div className="page-heading sales-heading">
        <div>
          <Title level={2}>
            {editingOrder ? `Sửa đơn ${editingOrder.order_code}` : "Bán hàng"}
          </Title>
          <Text type="secondary">
            {editingOrder
              ? "Đơn chưa xuất hóa đơn điện tử: có thể sửa món, số lượng, phụ thu và tiền thực thu."
              : "Lưu đơn sẽ trừ kho ngay; có thể thanh toán ngay hoặc thanh toán sau trong danh sách đơn."}
          </Text>
        </div>
        {onOpenOrders && (
          <Button onClick={onOpenOrders}>Đơn bán hàng</Button>
        )}
      </div>

      <div className="sales-pos-layout">
        <Card className="sales-menu-panel" loading={loading}>
          <div className="sales-menu-toolbar">
            <Input.Search
              allowClear
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm món..."
            />
            <Select
              value={group}
              onChange={setGroup}
              options={[
                { value: "ALL", label: "Tất cả nhóm" },
                ...groups.map((name) => ({ value: name, label: name }))
              ]}
            />
          </div>

          <div className="sales-menu-grid">
            {visibleMenu.map((item) => {
              const activeOptions = item.options.filter(
                (option) => option.is_active
              );
              const fromPrice = activeOptions.length
                ? Math.min(...activeOptions.map((option) => option.sale_price))
                : item.base_price;
              return (
                <button
                  className="sales-menu-card"
                  type="button"
                  key={item.id}
                  onClick={() => chooseItem(item)}
                >
                  <strong>{item.name}</strong>
                  <span>{item.menu_group_name}</span>
                  <b>{money(fromPrice)} đ</b>
                  {activeOptions.length > 0 && (
                    <small>{activeOptions.length} kiểu chế biến</small>
                  )}
                </button>
              );
            })}
            {!visibleMenu.length && (
              <div className="sales-empty-menu">Không có món phù hợp.</div>
            )}
          </div>
        </Card>

        <Card
          className="sales-cart-panel"
          title={editingOrder ? `Đang sửa ${editingOrder.order_code}` : "Đơn hiện tại"}
        >
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary">Thời gian hóa đơn</Text>
            <Input
              type="datetime-local"
              value={orderTimeLocal}
              onChange={(event) => setOrderTimeLocal(event.target.value)}
              disabled={Boolean(editingOrder?.has_einvoice)}
            />
          </div>
          <div className="sales-cart-lines">
            {cart.map((line) => (
              <div className="sales-cart-line" key={line.key}>
                <div className="sales-cart-name">
                  <strong>{line.item_name}</strong>
                  <Text type="secondary">
                    {line.option_name ?? line.unit_name}
                  </Text>
                  <div className="sales-line-surcharge-list">
                    {line.surcharges.map((surcharge) => (
                      <span
                        className="sales-surcharge-chip"
                        key={surcharge.key}
                      >
                        + {surcharge.name}: {money(surcharge.amount)} đ
                        <button
                          type="button"
                          aria-label={`Xóa phụ thu ${surcharge.name}`}
                          onClick={() =>
                            removeItemSurcharge(line.key, surcharge.key)
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <Button
                      type="link"
                      size="small"
                      className="sales-add-surcharge"
                      onClick={() => openItemSurcharge(line.key)}
                    >
                      + Phụ thu
                    </Button>
                  </div>
                </div>
                <div className="sales-cart-qty">
                  <Button
                    onClick={() =>
                      changeQuantity(line.key, line.quantity - 1)
                    }
                  >
                    −
                  </Button>
                  <InputNumber<number>
                    min={0.001}
                    value={line.quantity}
                    onChange={(value) =>
                      changeQuantity(line.key, Number(value ?? 1))
                    }
                  />
                  <Button
                    onClick={() =>
                      changeQuantity(line.key, line.quantity + 1)
                    }
                  >
                    +
                  </Button>
                </div>
                <div className="sales-cart-price">
                  <span>{money(line.unit_price)} đ</span>
                  {line.surcharges.length > 0 && (
                    <span>
                      + phụ thu {money(surchargeTotal(line.surcharges))} đ
                    </span>
                  )}
                  <strong>
                    {money(
                      line.quantity * line.unit_price +
                        surchargeTotal(line.surcharges)
                    )}{" "}
                    đ
                  </strong>
                </div>
                <Button
                  danger
                  type="text"
                  onClick={() =>
                    setCart((current) =>
                      current.filter((row) => row.key !== line.key)
                    )
                  }
                >
                  ×
                </Button>
              </div>
            ))}
            {!cart.length && (
              <div className="sales-cart-empty">Chọn món để bắt đầu đơn.</div>
            )}
          </div>

          <div className="sales-payment-box">
            <div className="sales-order-surcharge-box">
              <div className="sales-order-surcharge-head">
                <Text type="secondary">Phụ thu đơn hàng</Text>
                <Button
                  type="link"
                  size="small"
                  onClick={openOrderSurcharge}
                >
                  + Thêm phụ thu
                </Button>
              </div>
              {orderSurcharges.map((surcharge) => (
                <div
                  className="sales-order-surcharge-row"
                  key={surcharge.key}
                >
                  <span>{surcharge.name}</span>
                  <strong>+{money(surcharge.amount)} đ</strong>
                  <Button
                    type="text"
                    danger
                    size="small"
                    onClick={() => removeOrderSurcharge(surcharge.key)}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>

            <div className="sales-total">
              <span>Tổng thanh toán</span>
              <strong>{money(total)} đ</strong>
            </div>

            {editingOrder && (
              <label>
                <span>Trạng thái thanh toán</span>
                <Select
                  value={editPaymentStatus}
                  onChange={(value: "PAID" | "DEBT") => {
                    setEditPaymentStatus(value);
                    if (value === "PAID" && actualReceived <= 0) {
                      setActualReceived(Math.round(total));
                    }
                  }}
                  options={[
                    { value: "PAID", label: "Đã thanh toán" },
                    { value: "DEBT", label: "Nợ / Chưa thanh toán" }
                  ]}
                />
              </label>
            )}

            {(!editingOrder || editPaymentStatus === "PAID") ? (
              <>
                <div className="sales-payment-grid">
                  <label>
                    <span>Loại tiền</span>
                    <Select
                      value={accountType}
                      onChange={changeAccountType}
                      options={[
                        { value: "CASH", label: "Tiền mặt" },
                        { value: "BANK", label: "Chuyển khoản" }
                      ]}
                    />
                  </label>
                  <label>
                    <span>Quỹ / tài khoản</span>
                    <Select
                      value={fundAccountId}
                      onChange={setFundAccountId}
                      placeholder="Chọn quỹ"
                      options={activeAccounts.map((account) => ({
                        value: account.id,
                        label: account.name
                      }))}
                    />
                  </label>
                </div>

                <div className="sales-actual-row">
                  <span>Tiền thực thu</span>
                  <InputNumber<number>
                    min={0}
                    precision={0}
                    value={actualReceived}
                    onChange={(value) => {
                      setActualTouched(true);
                      setActualReceived(Number(value ?? 0));
                    }}
                    formatter={(value) =>
                      value === undefined || value === null
                        ? ""
                        : money(Number(value))
                    }
                    parser={(value) =>
                      Number((value ?? "").replace(/[^0-9]/g, ""))
                    }
                  />
                </div>

                <div className="sales-rounding-row">
                  <Text type="secondary">Chênh lệch làm tròn</Text>
                  <Text>
                    {actualReceived - total > 0 ? "+" : ""}
                    {money(actualReceived - total)} đ
                  </Text>
                </div>
              </>
            ) : (
              <Text type="secondary">
                Đơn nợ vẫn giữ nguyên phần kho đã bán, chưa ghi tiền vào quỹ/tài khoản.
              </Text>
            )}

            {editingOrder ? (
              <Button
                type="primary"
                size="large"
                block
                loading={saving}
                disabled={!cart.length}
                onClick={() => void checkout(false)}
              >
                LƯU THAY ĐỔI
              </Button>
            ) : (
              <Space.Compact block>
                <Button
                  size="large"
                  block
                  loading={saving}
                  disabled={!cart.length}
                  onClick={() => void checkout(false)}
                >
                  LƯU ĐƠN
                </Button>
                <Button
                  type="primary"
                  size="large"
                  block
                  loading={saving}
                  disabled={!cart.length}
                  onClick={() => void checkout(true)}
                >
                  THANH TOÁN
                </Button>
              </Space.Compact>
            )}
          </div>
        </Card>
      </div>

      <Modal
        open={optionItem !== null}
        title={
          optionItem ? `Chọn kiểu chế biến - ${optionItem.name}` : ""
        }
        footer={null}
        onCancel={() => setOptionItem(null)}
      >
        <div className="sales-option-list">
          {optionItem?.options
            .filter((option) => option.is_active)
            .map((option) => (
              <Button
                key={option.id}
                className="sales-option-button"
                onClick={() => addLine(optionItem, option)}
              >
                <span>{option.service_option_name}</span>
                <strong>{money(option.sale_price)} đ</strong>
              </Button>
            ))}
        </div>
      </Modal>

      <Modal
        open={surchargeTarget !== null}
        title={
          surchargeTarget?.type === "ITEM"
            ? "Thêm phụ thu cho món"
            : "Thêm phụ thu đơn hàng"
        }
        okText="Thêm phụ thu"
        cancelText="Hủy"
        onOk={() => void addSurcharge()}
        onCancel={() => setSurchargeTarget(null)}
      >
        <div className="sales-surcharge-form">
          <label>
            <span>Phụ thu đã lưu</span>
            <Space.Compact style={{ width: "100%" }}>
              <Select
                style={{ width: "100%" }}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Chọn phụ thu đã dùng"
                value={surchargePresetId}
                onChange={selectSurchargePreset}
                options={surchargePresets.map((preset) => ({
                  value: preset.id,
                  label: `${preset.name} - ${money(preset.amount)} đ`
                }))}
              />
              <Button
                aria-label="Tạo phụ thu mới"
                title="Tạo phụ thu mới"
                onClick={startNewSurcharge}
              >
                +
              </Button>
            </Space.Compact>
          </label>
          <label>
            <span>Tên phụ thu</span>
            <Input
              autoFocus
              value={surchargeName}
              maxLength={120}
              placeholder="VD: Thêm sốt, thêm phô mai..."
              onChange={(event) => setSurchargeName(event.target.value)}
              onPressEnter={() => void addSurcharge()}
            />
          </label>
          <label>
            <span>Số tiền</span>
            <InputNumber<number>
              min={1}
              precision={0}
              value={surchargeAmount}
              onChange={(value) => setSurchargeAmount(Number(value ?? 0))}
              formatter={(value) =>
                value === undefined || value === null
                  ? ""
                  : money(Number(value))
              }
              parser={(value) =>
                Number((value ?? "").replace(/[^0-9]/g, ""))
              }
              addonAfter="đ"
            />
          </label>
          <Text type="secondary">
            Phụ thu chỉ cộng vào tiền thanh toán, không tự trừ nguyên liệu trong kho.
          </Text>
        </div>
      </Modal>
    </>
  );
}

export function SalesOrdersPage({
  onEditOrder
}: {
  onEditOrder?: (order: SaleOrder) => void;
}) {
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [fundAccountFilter, setFundAccountFilter] = useState<string>("ALL");
  const [period, setPeriod] = useState<SalesPeriod>("TODAY");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selected, setSelected] = useState<SaleOrder | null>(null);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [paymentOrder, setPaymentOrder] = useState<SaleOrder | null>(null);
  const [paymentAccountType, setPaymentAccountType] =
    useState<FundAccountType>("CASH");
  const [paymentFundAccountId, setPaymentFundAccountId] = useState<number>();
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [messageApi, messageContext] = message.useMessage();

  const load = async () => {
    setLoading(true);
    try {
      const range = periodRange(period, customFrom, customTo);
      const [nextOrders, nextAccounts] = await Promise.all([
        getSaleOrders({
          search: search.trim() || undefined,
          status:
            statusFilter === "ALL"
              ? undefined
              : (statusFilter as "OPEN" | "PAID" | "DEBT" | "VOID"),
          from_date: range.from || undefined,
          to_date: range.to || undefined,
          fund_account_id:
            fundAccountFilter === "ALL" ? undefined : Number(fundAccountFilter)
        }),
        getFundAccounts()
      ]);
      setOrders(nextOrders);
      setAccounts(nextAccounts);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được đơn bán."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (period === "CUSTOM" && (!customFrom || !customTo)) return;
    void load();
  }, [statusFilter, fundAccountFilter, period, customFrom, customTo]);

  const statusTag = (order: SaleOrder) => {
    if (order.status === "VOID") return <Tag>Đã hủy</Tag>;
    if (order.status === "OPEN") return <Tag color="warning">Chưa thanh toán</Tag>;
    if (order.settlement_status === "DEBT") return <Tag color="orange">Ghi nợ</Tag>;
    return <Tag color="success">Đã thanh toán</Tag>;
  };

  const activePaymentAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.is_active && account.type === paymentAccountType
      ),
    [accounts, paymentAccountType]
  );

  const defaultPaymentAccount = (
    type: FundAccountType,
    source = accounts
  ) =>
    source.find(
      (account) =>
        account.is_active &&
        account.type === type &&
        account.is_default
    ) ??
    source.find(
      (account) => account.is_active && account.type === type
    );

  const openPayment = (order: SaleOrder) => {
    const preferred =
      defaultPaymentAccount("CASH") ??
      accounts.find((account) => account.is_active);

    setPaymentOrder(order);
    setPaymentAmount(order.total_amount);
    if (preferred) {
      setPaymentAccountType(preferred.type);
      setPaymentFundAccountId(preferred.id);
    } else {
      setPaymentAccountType("CASH");
      setPaymentFundAccountId(undefined);
    }
  };

  const changePaymentAccountType = (nextType: FundAccountType) => {
    setPaymentAccountType(nextType);
    setPaymentFundAccountId(defaultPaymentAccount(nextType)?.id);
  };

  const confirmPayment = async () => {
    if (!paymentOrder) return;
    if (!paymentFundAccountId) {
      messageApi.warning("Chọn quỹ/tài khoản nhận tiền.");
      return;
    }
    if (paymentOrder.total_amount > 0 && paymentAmount <= 0) {
      messageApi.warning("Tiền thực thu phải lớn hơn 0.");
      return;
    }

    setPaying(true);
    try {
      const paid = await paySaleOrder(paymentOrder.id, {
        fund_account_id: paymentFundAccountId,
        actual_received_amount: Math.round(paymentAmount)
      });
      if (selected?.id === paid.id) {
        setSelected(paid);
      }
      setPaymentOrder(null);
      await load();
      messageApi.success(
        `Đã thanh toán ${paid.order_code}. Tiền đã ghi vào quỹ/tài khoản.`
      );
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không thanh toán được đơn."
      );
    } finally {
      setPaying(false);
    }
  };

  const confirmDelete = (order: SaleOrder) => {
    Modal.confirm({
      title: `Xóa ${order.order_code}?`,
      content:
        order.status === "PAID"
          ? (order.settlement_status === "DEBT"
            ? "Đơn ghi nợ sẽ bị hủy và hoàn kho, không có khoản thu để hoàn."
            : "Đơn sẽ được xóa mềm; tiền thu được đảo lại và nguyên liệu được hoàn kho.")
          : "Đơn chưa thanh toán sẽ được xóa mềm và nguyên liệu đã trừ sẽ được hoàn về kho.",
      okText: "Xóa đơn",
      cancelText: "Không",
      okButtonProps: { danger: true },
      onOk: async () => {
        setVoiding(true);
        try {
          const updated = await voidSaleOrder(order.id);
          setSelected(updated);
          await load();
          messageApi.success(
            order.status === "PAID" && order.settlement_status === "PAID"
              ? "Đã xóa đơn, hoàn tiền và hoàn kho."
              : "Đã xóa đơn và hoàn kho."
          );
        } catch (error) {
          messageApi.error(
            error instanceof Error ? error.message : "Không xóa được đơn."
          );
        } finally {
          setVoiding(false);
        }
      }
    });
  };

  const activeOrders = useMemo(
    () => orders.filter((order) => order.status !== "VOID"),
    [orders]
  );
  const filteredTotal = useMemo(
    () => activeOrders.reduce((sum, order) => sum + order.total_amount, 0),
    [activeOrders]
  );
  const filteredActualReceived = useMemo(
    () =>
      activeOrders.reduce(
        (sum, order) => sum + (order.actual_received_amount ?? 0),
        0
      ),
    [activeOrders]
  );

  const columns: TableProps<SaleOrder>["columns"] = [
    {
      title: "Mã đơn",
      dataIndex: "order_code",
      width: 120,
      render: (value: string, row) => (
        <Button type="link" onClick={() => setSelected(row)}>
          {value}
        </Button>
      )
    },
    {
      title: "Thời gian",
      dataIndex: "order_time",
      width: 150,
      render: formatDateTime
    },
    {
      title: "Khách hàng",
      dataIndex: "customer_name",
      render: (value: string | null) => value ?? "Khách lẻ"
    },
    {
      title: "Tổng tiền",
      dataIndex: "total_amount",
      align: "right",
      width: 130,
      render: (value: number) => `${money(value)} đ`
    },
    {
      title: "Thực thu",
      dataIndex: "actual_received_amount",
      align: "right",
      width: 130,
      render: (value: number | null) =>
        value === null ? "—" : `${money(value)} đ`
    },
    {
      title: "Loại quỹ thanh toán",
      dataIndex: "fund_account_type",
      width: 170,
      render: (value: FundAccountType | null, row) => {
        if (row.status === "VOID") return <Tag>Đã hủy</Tag>;
        if (row.status === "OPEN") return <Tag>Chưa thanh toán</Tag>;
        if (row.settlement_status === "DEBT") return <Tag color="orange">Ghi nợ</Tag>;
        if (value === "CASH") return <Tag color="green">Tiền mặt</Tag>;
        if (value === "BANK") return <Tag color="blue">Chuyển khoản</Tag>;
        return <Tag>Chưa xác định</Tag>;
      }
    },
    {
      title: "Quỹ / tài khoản",
      dataIndex: "fund_account_name",
      width: 170,
      render: (value: string | null, row) =>
        row.status === "PAID" ? (value ?? "—") : "—"
    },
    {
      title: "Kho",
      dataIndex: "stock_deducted",
      width: 100,
      render: (value: boolean, row) =>
        row.status === "VOID" ? (
          <Tag>Đã hoàn</Tag>
        ) : value ? (
          <Tag color="blue">Đã trừ</Tag>
        ) : (
          <Tag>Chưa trừ</Tag>
        )
    },
    {
      title: "HĐĐT",
      dataIndex: "has_einvoice",
      width: 110,
      render: (value: boolean, row) =>
        value ? (
          <Tag color="blue">Đã xuất</Tag>
        ) : row.einvoice_requested ? (
          <Tag color="processing">Chờ phát hành</Tag>
        ) : (
          <Tag>Chưa xuất</Tag>
        )
    },
    {
      title: "Thao tác",
      width: 210,
      render: (_, row) => (
        <Space size={2}>
          {(row.status === "OPEN" ||
            (row.status === "PAID" && row.settlement_status === "DEBT")) && (
            <Button
              type="link"
              size="small"
              onClick={() => openPayment(row)}
            >
              {row.settlement_status === "DEBT" && row.status === "PAID" ? "Thu nợ" : "Thanh toán"}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            disabled={!row.can_edit}
            onClick={() => onEditOrder?.(row)}
          >
            Sửa
          </Button>
          <Button
            type="link"
            danger
            size="small"
            disabled={!row.can_delete}
            onClick={() => confirmDelete(row)}
          >
            Xóa
          </Button>
        </Space>
      )
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      width: 130,
      render: (_, row) => statusTag(row)
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Đơn bán hàng</Title>
          <Text type="secondary">
            Theo dõi đơn, tiền thu và trạng thái trừ kho.
          </Text>
        </div>
      </div>

      <div className="toolbar sales-orders-toolbar">
        <Input.Search
          allowClear
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onSearch={() => void load()}
          placeholder="Tìm mã đơn / khách hàng..."
          className="search-box"
        />
        <Select
          value={period}
          onChange={(value) => setPeriod(value as SalesPeriod)}
          style={{ minWidth: 130 }}
          options={[
            { value: "TODAY", label: "Hôm nay" },
            { value: "YESTERDAY", label: "Hôm qua" },
            { value: "MONTH", label: "Tháng này" },
            { value: "QUARTER", label: "Quý này" },
            { value: "YEAR", label: "Năm nay" },
            { value: "CUSTOM", label: "Tùy chọn" }
          ]}
        />
        {period === "CUSTOM" && (
          <>
            <Input
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
              style={{ width: 145 }}
              aria-label="Từ ngày"
            />
            <Input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(event) => setCustomTo(event.target.value)}
              style={{ width: 145 }}
              aria-label="Đến ngày"
            />
          </>
        )}
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "ALL", label: "Tất cả trạng thái" },
            { value: "PAID", label: "Đã thanh toán" },
            { value: "DEBT", label: "Ghi nợ" },
            { value: "OPEN", label: "Chưa thanh toán" },
            { value: "VOID", label: "Đã hủy" }
          ]}
        />
        <Select
          value={fundAccountFilter}
          onChange={setFundAccountFilter}
          style={{ minWidth: 170 }}
          options={[
            { value: "ALL", label: "Tất cả tài khoản" },
            ...accounts.map((account) => ({
              value: String(account.id),
              label: account.name
            }))
          ]}
        />
        <Button onClick={() => void load()}>Làm mới</Button>
      </div>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size="large">
          <Text strong>{periodLabel(period)}</Text>
          <Text>
            <strong>{activeOrders.length}</strong> đơn
          </Text>
          <Text>
            Tổng tiền: <strong>{money(filteredTotal)} đ</strong>
          </Text>
          <Text>
            Thực thu: <strong>{money(filteredActualReceived)} đ</strong>
          </Text>
        </Space>
      </Card>

      <div className="table-card">
        <Table<SaleOrder>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={orders}
          scroll={{ x: 1520 }}
          pagination={{ pageSize: 30 }}
          rowClassName={(row) =>
            row.status === "VOID" ? "sales-row-void" : ""
          }
        />
      </div>

      <Modal
        open={selected !== null}
        width={900}
        title={selected ? `Đơn bán ${selected.order_code}` : "Đơn bán"}
        onCancel={() => setSelected(null)}
        footer={
          selected ? (
            <Space>
              <Button onClick={() => setSelected(null)}>Đóng</Button>
              {selected.status !== "VOID" && (
                <>
                  {(selected.status === "OPEN" ||
                    (selected.status === "PAID" && selected.settlement_status === "DEBT")) && (
                    <Button
                      type="primary"
                      onClick={() => openPayment(selected)}
                    >
                      {selected.settlement_status === "DEBT" && selected.status === "PAID"
                        ? "Thu nợ" : "Thanh toán"}
                    </Button>
                  )}
                  <Button
                    disabled={!selected.can_edit}
                    onClick={() => onEditOrder?.(selected)}
                  >
                    Sửa
                  </Button>
                  <Button
                    danger
                    disabled={!selected.can_delete}
                    loading={voiding}
                    onClick={() => confirmDelete(selected)}
                  >
                    Xóa đơn
                  </Button>
                </>
              )}
            </Space>
          ) : null
        }
      >
        {selected && (
          <>
            <div className="sales-order-meta">
              <div>
                <Text type="secondary">Thời gian</Text>
                <strong>{formatDateTime(selected.order_time)}</strong>
              </div>
              <div>
                <Text type="secondary">Khách hàng</Text>
                <strong>{selected.customer_name ?? "Khách lẻ"}</strong>
              </div>
              <div>
                <Text type="secondary">Tổng tiền</Text>
                <strong>{money(selected.total_amount)} đ</strong>
              </div>
              <div>
                <Text type="secondary">Tổng phụ thu</Text>
                <strong>{money(selected.surcharge_total)} đ</strong>
              </div>
              <div>
                <Text type="secondary">Hóa đơn điện tử</Text>
                <strong>
                  {selected.has_einvoice ? "Đã phát hành" :
                    selected.einvoice_requested ? "Chờ phát hành" : "Chưa phát hành"}
                </strong>
              </div>
              <div>
                <Text type="secondary">Tiền thực thu</Text>
                <strong>
                  {selected.actual_received_amount === null
                    ? "—"
                    : `${money(selected.actual_received_amount)} đ`}
                </strong>
              </div>
              <div>
                <Text type="secondary">Quỹ / tài khoản</Text>
                <strong>{selected.fund_account_name ?? "—"}</strong>
              </div>
              <div>
                <Text type="secondary">Kho</Text>
                <strong>
                  {selected.status === "VOID"
                    ? "Đã hoàn kho"
                    : selected.stock_deducted
                      ? "Đã trừ kho"
                      : "Chưa trừ"}
                </strong>
              </div>
            </div>

            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={selected.items}
              columns={[
                {
                  title: "Món",
                  dataIndex: "item_name_snapshot",
                  render: (value: string, row) => (
                    <div>
                      <strong>{value}</strong>
                      {row.option_name_snapshot && (
                        <div>
                          <Text type="secondary">
                            {row.option_name_snapshot}
                          </Text>
                        </div>
                      )}
                      {row.surcharges.map((surcharge) => (
                        <div
                          className="sales-order-line-surcharge"
                          key={surcharge.id}
                        >
                          + {surcharge.name}: {money(surcharge.amount)} đ
                        </div>
                      ))}
                    </div>
                  )
                },
                {
                  title: "ĐVT",
                  dataIndex: "unit_name_snapshot",
                  width: 90
                },
                {
                  title: "SL",
                  dataIndex: "quantity",
                  align: "right",
                  width: 80
                },
                {
                  title: "Đơn giá",
                  dataIndex: "unit_price",
                  align: "right",
                  width: 130,
                  render: (value: number) => money(value)
                },
                {
                  title: "Phụ thu",
                  dataIndex: "surcharge_total",
                  align: "right",
                  width: 110,
                  render: (value: number) =>
                    value > 0 ? `+${money(value)}` : "—"
                },
                {
                  title: "Thành tiền",
                  dataIndex: "total_with_surcharges",
                  align: "right",
                  width: 140,
                  render: (value: number) => money(value)
                }
              ]}
            />

            {selected.surcharges.length > 0 && (
              <div className="sales-order-extra-surcharges">
                <Text strong>Phụ thu đơn hàng</Text>
                {selected.surcharges.map((surcharge) => (
                  <div key={surcharge.id}>
                    <span>{surcharge.name}</span>
                    <strong>+{money(surcharge.amount)} đ</strong>
                  </div>
                ))}
              </div>
            )}

            {selected.status === "VOID" && selected.void_reason && (
              <div className="sales-void-note">
                <Text type="secondary">Lý do hủy: </Text>
                <Text>{selected.void_reason}</Text>
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal
        open={paymentOrder !== null}
        title={
          paymentOrder
            ? `Thanh toán ${paymentOrder.order_code}`
            : "Thanh toán đơn"
        }
        okText="Xác nhận thanh toán"
        cancelText="Hủy"
        confirmLoading={paying}
        onOk={() => void confirmPayment()}
        onCancel={() => {
          if (!paying) setPaymentOrder(null);
        }}
      >
        {paymentOrder && (
          <div className="sales-payment-box">
            <div className="sales-total">
              <span>Tổng thanh toán</span>
              <strong>{money(paymentOrder.total_amount)} đ</strong>
            </div>

            <div className="sales-payment-grid">
              <label>
                <span>Loại tiền</span>
                <Select
                  value={paymentAccountType}
                  onChange={changePaymentAccountType}
                  options={[
                    { value: "CASH", label: "Tiền mặt" },
                    { value: "BANK", label: "Chuyển khoản" }
                  ]}
                />
              </label>
              <label>
                <span>Quỹ / tài khoản</span>
                <Select
                  value={paymentFundAccountId}
                  onChange={setPaymentFundAccountId}
                  placeholder="Chọn quỹ"
                  options={activePaymentAccounts.map((account) => ({
                    value: account.id,
                    label: account.name
                  }))}
                />
              </label>
            </div>

            <div className="sales-actual-row">
              <span>Tiền thực thu</span>
              <InputNumber<number>
                min={0}
                precision={0}
                value={paymentAmount}
                onChange={(value) =>
                  setPaymentAmount(Number(value ?? 0))
                }
                formatter={(value) =>
                  value === undefined || value === null
                    ? ""
                    : money(Number(value))
                }
                parser={(value) =>
                  Number((value ?? "").replace(/[^0-9]/g, ""))
                }
                addonAfter="đ"
              />
            </div>

            <div className="sales-rounding-row">
              <Text type="secondary">Chênh lệch làm tròn</Text>
              <Text>
                {paymentAmount - paymentOrder.total_amount > 0 ? "+" : ""}
                {money(paymentAmount - paymentOrder.total_amount)} đ
              </Text>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
