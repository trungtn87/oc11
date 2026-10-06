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
  getFundAccounts,
  getMenuItems,
  getSaleOrders,
  paySaleOrder,
  voidSaleOrder
} from "./api";
import type {
  FundAccount,
  FundAccountType,
  MenuItem,
  MenuItemOption,
  SaleOrder
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

export function SalesPosPage({
  onOpenOrders
}: {
  onOpenOrders?: () => void;
}) {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string>("ALL");
  const [accountType, setAccountType] = useState<FundAccountType>("CASH");
  const [fundAccountId, setFundAccountId] = useState<number>();
  const [actualReceived, setActualReceived] = useState<number>(0);
  const [actualTouched, setActualTouched] = useState(false);
  const [optionItem, setOptionItem] = useState<MenuItem | null>(null);
  const [orderSurcharges, setOrderSurcharges] = useState<CartSurcharge[]>([]);
  const [surchargeTarget, setSurchargeTarget] = useState<
    { type: "ITEM"; lineKey: string } | { type: "ORDER" } | null
  >(null);
  const [surchargeName, setSurchargeName] = useState("");
  const [surchargeAmount, setSurchargeAmount] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messageApi, messageContext] = message.useMessage();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [menu, funds] = await Promise.all([
          getMenuItems(),
          getFundAccounts()
        ]);
        if (cancelled) return;
        setMenuItems(menu.filter((item) => item.is_active));
        setAccounts(funds);
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
    setSurchargeName("");
    setSurchargeAmount(0);
    setSurchargeTarget({ type: "ITEM", lineKey });
  };

  const openOrderSurcharge = () => {
    setSurchargeName("");
    setSurchargeAmount(0);
    setSurchargeTarget({ type: "ORDER" });
  };

  const addSurcharge = () => {
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

  const checkout = async () => {
    if (!cart.length) {
      messageApi.warning("Chưa có món trong đơn.");
      return;
    }
    if (!fundAccountId) {
      messageApi.warning("Chọn quỹ/tài khoản nhận tiền.");
      return;
    }

    setSaving(true);
    let created: SaleOrder | null = null;
    try {
      created = await createSaleOrder({
        order_time: new Date().toISOString(),
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
        }))
      });

      const paid = await paySaleOrder(created.id, {
        fund_account_id: fundAccountId,
        actual_received_amount: Math.round(actualReceived)
      });

      setCart([]);
      setOrderSurcharges([]);
      setActualTouched(false);
      setActualReceived(0);
      messageApi.success(
        `Đã thanh toán ${paid.order_code}. Kho đã được trừ tự động.`
      );
    } catch (error) {
      if (created) {
        try {
          await voidSaleOrder(
            created.id,
            "Hủy tự động do thanh toán không hoàn tất"
          );
        } catch {
          // Keep the original payment/stock error visible.
        }
      }
      messageApi.error(
        error instanceof Error
          ? error.message
          : "Không hoàn tất được đơn bán."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {messageContext}
      <div className="page-heading sales-heading">
        <div>
          <Title level={2}>Bán hàng</Title>
          <Text type="secondary">
            Thanh toán xong hệ thống tự ghi thu và trừ nguyên liệu trong kho.
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

        <Card className="sales-cart-panel" title="Đơn hiện tại">
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

            <Button
              type="primary"
              size="large"
              block
              loading={saving}
              disabled={!cart.length}
              onClick={() => void checkout()}
            >
              THANH TOÁN
            </Button>
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
        onOk={addSurcharge}
        onCancel={() => setSurchargeTarget(null)}
      >
        <div className="sales-surcharge-form">
          <label>
            <span>Tên phụ thu</span>
            <Input
              autoFocus
              value={surchargeName}
              maxLength={120}
              placeholder="VD: Thêm sốt, thêm phô mai..."
              onChange={(event) => setSurchargeName(event.target.value)}
              onPressEnter={addSurcharge}
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

export function SalesOrdersPage() {
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selected, setSelected] = useState<SaleOrder | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [messageApi, messageContext] = message.useMessage();

  const load = async () => {
    setLoading(true);
    try {
      setOrders(
        await getSaleOrders({
          search: search.trim() || undefined,
          status:
            statusFilter === "ALL"
              ? undefined
              : (statusFilter as "OPEN" | "PAID" | "VOID")
        })
      );
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được đơn bán."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [statusFilter]);

  const statusTag = (status: SaleOrder["status"]) => {
    if (status === "PAID") return <Tag color="success">Đã thanh toán</Tag>;
    if (status === "VOID") return <Tag>Đã hủy</Tag>;
    return <Tag color="warning">Chưa thanh toán</Tag>;
  };

  const confirmVoid = (order: SaleOrder) => {
    Modal.confirm({
      title: `Hủy ${order.order_code}?`,
      content:
        order.status === "PAID"
          ? "Tiền thu sẽ được đảo lại và toàn bộ nguyên liệu đã trừ sẽ được hoàn về kho."
          : "Đơn chưa thanh toán sẽ được chuyển sang trạng thái đã hủy.",
      okText: "Hủy đơn",
      cancelText: "Không",
      okButtonProps: { danger: true },
      onOk: async () => {
        setVoiding(true);
        try {
          const updated = await voidSaleOrder(order.id);
          setSelected(updated);
          await load();
          messageApi.success(
            order.status === "PAID"
              ? "Đã hủy đơn, hoàn tiền và hoàn kho."
              : "Đã hủy đơn."
          );
        } catch (error) {
          messageApi.error(
            error instanceof Error ? error.message : "Không hủy được đơn."
          );
        } finally {
          setVoiding(false);
        }
      }
    });
  };

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
      title: "Quỹ / tài khoản",
      dataIndex: "fund_account_name",
      width: 170,
      render: (value: string | null) => value ?? "—"
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
      title: "Trạng thái",
      dataIndex: "status",
      width: 130,
      render: statusTag
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
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "ALL", label: "Tất cả trạng thái" },
            { value: "PAID", label: "Đã thanh toán" },
            { value: "OPEN", label: "Chưa thanh toán" },
            { value: "VOID", label: "Đã hủy" }
          ]}
        />
        <Button onClick={() => void load()}>Làm mới</Button>
      </div>

      <div className="table-card">
        <Table<SaleOrder>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={orders}
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
                <Button
                  danger
                  loading={voiding}
                  onClick={() => confirmVoid(selected)}
                >
                  Hủy đơn
                </Button>
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
    </>
  );
}
