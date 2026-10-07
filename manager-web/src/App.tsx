import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  message,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography
} from "antd";
import type { MenuProps, TableProps } from "antd";
import {
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  BookOutlined,
  BarsOutlined,
  CalendarOutlined,
  ContainerOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  HomeOutlined,
  ImportOutlined,
  InboxOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
  WalletOutlined
} from "@ant-design/icons";

import {
  createInventoryItem,
  createItemGroup,
  createSupplier,
  createUnit,
  deleteSupplier,
  getBackupStatus,
  getFundAccounts,
  getFundTransactions,
  getInventoryItems,
  getInventoryStock,
  getItemGroups,
  getPurchaseReceipts,
  getSaleOrders,
  getSuppliers,
  getUnits,
  runBackup,
  selectBackupFolder,
  updateInventoryItem,
  updateItemGroup,
  updateSupplier,
  updateUnit,
  useLocalBackupFolder
} from "./api";
import { BankAccountsPage, CashFundsPage } from "./FundAccountsPage";
import { BankLedgerPage, CashLedgerPage } from "./MoneyLedgerPage";
import FundTransactionCategoriesPage from "./FundTransactionCategoriesPage";
import InventoryStockPage from "./InventoryStockPage";
import ConsumptionPage from "./ConsumptionPage";
import PurchaseOrdersPage from "./PurchaseOrdersPage";
import CostRecipesPage from "./CostRecipesPage";
import MenuGroupsPage from "./MenuGroupsPage";
import MenuItemsPage from "./MenuItemsPage";
import { SalesOrdersPage, SalesPosPage } from "./SalesPage";
import {
  KitchenPrinterSettings,
  RestaurantTablesSettings
} from "./RestaurantSettingsPage";
import { oc11LogoDataUri } from "./oc11LogoData";
import type {
  BackupStatus,
  FundAccount,
  FundTransaction,
  InventoryItem,
  InventoryItemInput,
  InventoryStock,
  ItemGroup,
  ItemGroupInput,
  PurchaseReceipt,
  SaleOrder,
  Supplier,
  SupplierInput,
  Unit,
  UnitInput,
  VoucherPrefill
} from "./types";

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

type StatusFilter = "all" | "active" | "inactive";

type GroupForm = {
  name: string;
  note?: string;
  is_active: boolean;
};

type SupplierForm = {
  name: string;
  phone?: string;
  address?: string;
  note?: string;
  bank_name?: string;
  bank_account_number?: string;
  bank_account_name?: string;
  payment_qr_image?: string | null;
};

type SupplierMode = "create" | "view" | "edit";

type UnitForm = {
  name: string;
  is_active: boolean;
};

type InventoryItemForm = {
  name: string;
  item_group_id: number;
  default_unit_id: number;
  smallest_unit_id: number;
  note?: string;
  is_active: boolean;
};

type ConversionDraft = {
  unit_id: number;
  quantity_in_smallest_unit: number | null;
  is_active: boolean;
};

const menuItems: MenuProps["items"] = [
  { key: "dashboard", icon: <HomeOutlined />, label: "Tổng quan" },
  {
    key: "sales",
    icon: <ShoppingCartOutlined />,
    label: "Bán hàng",
    children: [
      { key: "sales-pos", icon: <ShoppingCartOutlined />, label: "Bán hàng" },
      { key: "sales-orders", icon: <FileTextOutlined />, label: "Đơn bán hàng" }
    ]
  },
  {
    key: "items",
    icon: <AppstoreOutlined />,
    label: "Hàng hóa",
    children: [
      { key: "item-list", icon: <BarsOutlined />, label: "Danh sách hàng hóa" },
      { key: "item-groups", icon: <TagsOutlined />, label: "Nhóm hàng hóa" },
      { key: "units", icon: <ContainerOutlined />, label: "Đơn vị tính" }
    ]
  },
  {
    key: "menu",
    icon: <BookOutlined />,
    label: "Thực đơn",
    children: [
      {
        key: "menu-items",
        icon: <BarsOutlined />,
        label: "Món thực đơn"
      },
      {
        key: "menu-groups",
        icon: <TagsOutlined />,
        label: "Nhóm thực đơn"
      },
      {
        key: "menu-cost",
        icon: <AuditOutlined />,
        label: "Kiểu chế biến & Cost"
      }
    ]
  },
  {
    key: "purchases",
    icon: <ImportOutlined />,
    label: "Nhập hàng",
    children: [
      { key: "purchase-orders", icon: <FileTextOutlined />, label: "Phiếu nhập" },
      { key: "suppliers", icon: <TeamOutlined />, label: "Nhà cung cấp" }
    ]
  },
  {
    key: "inventory",
    icon: <DatabaseOutlined />,
    label: "Kho",
    children: [
      { key: "stock", icon: <InboxOutlined />, label: "Tồn kho thực tế" },
      { key: "stock-sales", icon: <AuditOutlined />, label: "Kho tiêu thụ" }
    ]
  },
  {
    key: "cash",
    icon: <WalletOutlined />,
    label: "Thu chi",
    children: [
      { key: "fund-accounts", icon: <WalletOutlined />, label: "Quỹ tiền mặt & tài khoản ngân hàng" },
      { key: "money-ledgers", icon: <FileTextOutlined />, label: "Sổ tiền mặt - Sổ tiền gửi" },
      { key: "cash-categories", icon: <TagsOutlined />, label: "Loại thu/chi" }
    ]
  },
  {
    key: "reports",
    icon: <BarChartOutlined />,
    label: "Báo cáo",
    children: [
      { key: "report-revenue", icon: <FileTextOutlined />, label: "Doanh thu" },
      { key: "report-stock", icon: <FileTextOutlined />, label: "Tồn kho" },
      { key: "report-purchases", icon: <FileTextOutlined />, label: "Nhập hàng" },
      { key: "report-cash", icon: <FileTextOutlined />, label: "Thu chi" },
      { key: "report-profit", icon: <FileTextOutlined />, label: "Lợi nhuận (sau này)" }
    ]
  },
  { key: "settings", icon: <SettingOutlined />, label: "Cài đặt" }
];

function BrandLogo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`brand ${collapsed ? "brand-collapsed" : ""}`}>
      <img
        src={oc11LogoDataUri}
        alt="Ốc 11"
        className="brand-home-logo"
      />
    </div>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + " đ";
}

function localDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value.slice(0, 10) : "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type DashboardPeriod =
  | "TODAY"
  | "YESTERDAY"
  | "MONTH"
  | "QUARTER"
  | "YEAR"
  | "CUSTOM";

function dashboardPeriodRange(
  period: DashboardPeriod,
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
    from = new Date(
      today.getFullYear(),
      Math.floor(today.getMonth() / 3) * 3,
      1
    );
  } else if (period === "YEAR") {
    from = new Date(today.getFullYear(), 0, 1);
  }

  return { from: localDateKey(from), to: localDateKey(to) };
}

function dashboardPeriodLabel(period: DashboardPeriod) {
  if (period === "TODAY") return "hôm nay";
  if (period === "YESTERDAY") return "hôm qua";
  if (period === "MONTH") return "tháng này";
  if (period === "QUARTER") return "quý này";
  if (period === "YEAR") return "năm nay";
  return "khoảng đã chọn";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function Dashboard({ onNavigate }: { onNavigate: (key: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [purchaseReceipts, setPurchaseReceipts] = useState<PurchaseReceipt[]>([]);
  const [fundAccounts, setFundAccounts] = useState<FundAccount[]>([]);
  const [fundTransactions, setFundTransactions] = useState<FundTransaction[]>([]);
  const [inventoryStock, setInventoryStock] = useState<InventoryStock[]>([]);
  const [salesOrders, setSalesOrders] = useState<SaleOrder[]>([]);
  const [period, setPeriod] = useState<DashboardPeriod>("TODAY");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setDashboardError("");

      try {
        const [receipts, accounts, cashLedger, bankLedger, stock, orders] =
          await Promise.all([
            getPurchaseReceipts(),
            getFundAccounts(),
            getFundTransactions({ account_type: "CASH" }),
            getFundTransactions({ account_type: "BANK" }),
            getInventoryStock(),
            getSaleOrders()
          ]);

        if (cancelled) {
          return;
        }

        setPurchaseReceipts(receipts);
        setFundAccounts(accounts);
        setFundTransactions([...cashLedger.items, ...bankLedger.items]);
        setInventoryStock(stock);
        setSalesOrders(orders);
      } catch (error) {
        if (!cancelled) {
          setDashboardError(
            error instanceof Error
              ? error.message
              : "Không tải được dữ liệu tổng quan."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  const range = dashboardPeriodRange(period, customFrom, customTo);
  const inSelectedPeriod = (value: string) => {
    const key = localDateKey(value);
    if (!range.from || !range.to) return false;
    return key >= range.from && key <= range.to;
  };

  const activeReceipts = purchaseReceipts.filter((receipt) => !receipt.is_void);
  const periodReceipts = activeReceipts.filter((receipt) =>
    inSelectedPeriod(receipt.receipt_time)
  );
  const periodTransactions = fundTransactions.filter((transaction) =>
    inSelectedPeriod(transaction.transaction_time)
  );
  const normalPeriodTransactions = periodTransactions.filter(
    (transaction) => transaction.transaction_type === "NORMAL"
  );
  const periodSalesOrders = salesOrders.filter(
    (order) => order.status !== "VOID" && inSelectedPeriod(order.order_time)
  );

  const periodSalesTotal = periodSalesOrders.reduce(
    (sum, order) => sum + order.total_amount,
    0
  );
  const periodPurchaseTotal = periodReceipts.reduce(
    (sum, receipt) => sum + receipt.total_amount,
    0
  );
  const periodExpenseTotal = normalPeriodTransactions
    .filter((transaction) => transaction.direction === "OUT")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const periodIncomeTotal = normalPeriodTransactions
    .filter((transaction) => transaction.direction === "IN")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalFundBalance = fundAccounts.reduce(
    (sum, account) => sum + account.current_balance,
    0
  );

  const stockAvailableCount = inventoryStock.filter(
    (item) => item.stock_quantity > 0
  ).length;
  const stockEmptyCount = inventoryStock.filter(
    (item) => item.stock_quantity <= 0
  ).length;
  const stockPercent =
    inventoryStock.length > 0
      ? Math.round((stockAvailableCount / inventoryStock.length) * 100)
      : 0;

  const recentActivities = [
    ...periodReceipts.map((receipt) => ({
      id: `purchase-${receipt.id}`,
      time: receipt.receipt_time,
      title: `Nhập hàng ${receipt.receipt_code}`,
      description: receipt.supplier_name,
      amount: receipt.total_amount,
      direction: "PURCHASE" as const
    })),
    ...periodTransactions
      .filter((transaction) => transaction.transaction_type === "NORMAL")
      .map((transaction) => ({
        id: `fund-${transaction.id}`,
        time: transaction.transaction_time,
        title:
          transaction.direction === "IN"
            ? `Phiếu thu ${transaction.reference_code ?? ""}`.trim()
            : `Phiếu chi ${transaction.reference_code ?? ""}`.trim(),
        description:
          transaction.description ||
          transaction.category_name ||
          transaction.fund_account_name,
        amount: transaction.amount,
        direction: transaction.direction
      }))
  ]
    .sort(
      (a, b) =>
        new Date(b.time).getTime() - new Date(a.time).getTime()
    )
    .slice(0, 6);

  const metricCards = [
    {
      label: `Doanh thu ${dashboardPeriodLabel(period)}`,
      value: periodSalesTotal,
      suffix: "đ",
      tone: "green",
      note: `${periodSalesOrders.length} đơn bán`
    },
    {
      label: `Nhập hàng ${dashboardPeriodLabel(period)}`,
      value: periodPurchaseTotal,
      suffix: "đ",
      tone: "blue",
      note: `${periodReceipts.length} phiếu nhập`
    },
    {
      label: `Chi ${dashboardPeriodLabel(period)}`,
      value: periodExpenseTotal,
      suffix: "đ",
      tone: "red",
      note: "Không tính chuyển quỹ / cân đối"
    },
    {
      label: "Tổng số dư quỹ",
      value: totalFundBalance,
      suffix: "đ",
      tone: "orange",
      note: `Số dư hiện tại · ${fundAccounts.length} quỹ / tài khoản`
    }
  ];

  const quickActions = [
    { label: "Bán hàng (POS)", target: "sales-pos", disabled: false },
    { label: "Nhập hàng", target: "purchase-orders", disabled: false },
    { label: "Sổ tiền", target: "money-ledgers", disabled: false },
    { label: "Thêm hàng hóa", target: "item-list", disabled: false },
    { label: "Tồn kho", target: "stock", disabled: false }
  ];

  return (
    <>
      <div className="dashboard-heading">
        <div>
          <Title level={2}>Tổng quan</Title>
          <Text type="secondary">
            Các phần đã có dữ liệu thật được cập nhật trực tiếp từ hệ thống.
          </Text>
          {dashboardError ? (
            <div className="dashboard-error">
              <Text type="danger">{dashboardError}</Text>
            </div>
          ) : null}
        </div>
        <Space wrap>
          <Select
            value={period}
            onChange={(value) => setPeriod(value as DashboardPeriod)}
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
        </Space>
      </div>

      <Card className="dashboard-card dashboard-quick-card" title="Thao tác nhanh">
        <div className="quick-actions">
          {quickActions.map((action) => (
            <Button
              key={action.label}
              type={action.disabled ? "default" : "primary"}
              disabled={action.disabled}
              onClick={() => onNavigate(action.target)}
              className="quick-action-btn"
            >
              {action.label}
            </Button>
          ))}
        </div>
      </Card>

      <Row gutter={[14, 14]} className="metrics-row">
        {metricCards.map((metric) => (
          <Col xs={24} sm={12} xl={6} key={metric.label}>
            <Card
              className={`metric-card metric-${metric.tone}`}
              bordered={false}
              loading={loading}
            >
              <Statistic
                title={metric.label}
                value={metric.value}
                precision={0}
                suffix={metric.suffix}
                formatter={(value) =>
                  metric.suffix === "đ"
                    ? new Intl.NumberFormat("vi-VN").format(Number(value))
                    : String(value)
                }
              />
              <Text type="secondary" className="metric-note">
                {metric.note}
              </Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[14, 14]} className="dashboard-grid">
        <Col xs={24} xl={16}>
          <Card
            className="dashboard-card"
            title={`Doanh thu ${dashboardPeriodLabel(period)}`}
            loading={loading}
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <Statistic
                  title="Tổng tiền đơn"
                  value={periodSalesTotal}
                  suffix="đ"
                  formatter={(value) =>
                    new Intl.NumberFormat("vi-VN").format(Number(value))
                  }
                />
              </Col>
              <Col xs={24} md={8}>
                <Statistic
                  title="Số đơn"
                  value={periodSalesOrders.length}
                />
              </Col>
              <Col xs={24} md={8}>
                <Statistic
                  title="Thực thu"
                  value={periodSalesOrders.reduce(
                    (sum, order) => sum + (order.actual_received_amount ?? 0),
                    0
                  )}
                  suffix="đ"
                  formatter={(value) =>
                    new Intl.NumberFormat("vi-VN").format(Number(value))
                  }
                />
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card className="dashboard-card" title="Tình trạng tồn kho" loading={loading}>
            {inventoryStock.length > 0 ? (
              <div className="dashboard-stock-summary">
                <Progress
                  type="circle"
                  percent={stockPercent}
                  size={150}
                  format={() => `${stockAvailableCount}/${inventoryStock.length}`}
                  strokeWidth={12}
                />
                <div className="dashboard-stock-copy">
                  <Text strong>{stockAvailableCount} mặt hàng đang có tồn</Text>
                  <Text type={stockEmptyCount > 0 ? "danger" : "secondary"}>
                    {stockEmptyCount} mặt hàng hết hoặc âm kho
                  </Text>
                  <Button size="small" onClick={() => onNavigate("stock")}>
                    Xem tồn kho
                  </Button>
                </div>
              </div>
            ) : (
              <div className="compact-empty">
                <Text strong>Chưa có dữ liệu tồn kho</Text>
                <Text type="secondary">
                  Dữ liệu sẽ xuất hiện sau khi có hàng hóa và nhập kho.
                </Text>
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            className="dashboard-card"
            title={`Dòng tiền ${dashboardPeriodLabel(period)}`}
            loading={loading}
          >
            <div className="dashboard-money-summary">
              <div>
                <Text type="secondary">Thu</Text>
                <Text strong className="dashboard-money-in">
                  {formatMoney(periodIncomeTotal)}
                </Text>
              </div>
              <div>
                <Text type="secondary">Chi</Text>
                <Text strong type="danger">
                  {formatMoney(periodExpenseTotal)}
                </Text>
              </div>
              <div>
                <Text type="secondary">Chênh lệch</Text>
                <Text strong>
                  {formatMoney(periodIncomeTotal - periodExpenseTotal)}
                </Text>
              </div>
            </div>
            <Text type="secondary" className="dashboard-section-note">
              Chỉ tính phiếu thu/chi thông thường, không tính chuyển quỹ và cân đối.
            </Text>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            className="dashboard-card"
            title={`Nhập hàng ${dashboardPeriodLabel(period)}`}
            extra={<Tag>{periodReceipts.length} phiếu</Tag>}
            loading={loading}
          >
            {periodReceipts.length > 0 ? (
              <div className="dashboard-mini-list">
                {periodReceipts
                  .slice()
                  .sort(
                    (a, b) =>
                      new Date(b.receipt_time).getTime() -
                      new Date(a.receipt_time).getTime()
                  )
                  .slice(0, 4)
                  .map((receipt) => (
                    <div className="dashboard-mini-row" key={receipt.id}>
                      <div>
                        <Text strong>{receipt.receipt_code}</Text>
                        <div>
                          <Text type="secondary">
                            {receipt.supplier_name} • {formatDateTime(receipt.receipt_time)}
                          </Text>
                        </div>
                      </div>
                      <Text strong>{formatMoney(receipt.total_amount)}</Text>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="compact-empty">
                <Text strong>Chưa có phiếu nhập</Text>
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            className="dashboard-card"
            title={`Hoạt động ${dashboardPeriodLabel(period)}`}
            loading={loading}
          >
            {recentActivities.length > 0 ? (
              <div className="dashboard-activity-list">
                {recentActivities.map((activity) => (
                  <div className="dashboard-activity-row" key={activity.id}>
                    <div
                      className={`activity-dot activity-dot-${activity.direction.toLowerCase()}`}
                    />
                    <div className="dashboard-activity-copy">
                      <Text strong>{activity.title}</Text>
                      <div>
                        <Text type="secondary">
                          {activity.description} • {formatDateTime(activity.time)}
                        </Text>
                      </div>
                    </div>
                    <Text strong>{formatMoney(activity.amount)}</Text>
                  </div>
                ))}
              </div>
            ) : (
              <div className="compact-empty">
                <Text strong>Chưa có hoạt động</Text>
                <Text type="secondary">
                  Phiếu nhập và thu/chi mới sẽ hiển thị tại đây.
                </Text>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]} className="dashboard-bottom">
        <Col xs={24}>
          <Card className="dashboard-card" title="Báo cáo nhanh">
            <div className="report-links">
              <Button disabled>Xem doanh thu</Button>
              <Button onClick={() => onNavigate("stock")}>Xem tồn kho</Button>
              <Button onClick={() => onNavigate("purchase-orders")}>
                Xem nhập hàng
              </Button>
              <Button onClick={() => onNavigate("money-ledgers")}>Xem thu chi</Button>
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
}

function InventoryItemsPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [groupFilter, setGroupFilter] = useState<number | "all">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [conversions, setConversions] = useState<ConversionDraft[]>([]);
  const [quickGroupOpen, setQuickGroupOpen] = useState(false);
  const [quickUnitOpen, setQuickUnitOpen] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [form] = Form.useForm<InventoryItemForm>();
  const [quickGroupForm] = Form.useForm<GroupForm>();
  const [quickUnitForm] = Form.useForm<UnitForm>();
  const [messageApi, messageContext] = message.useMessage();

  const loadData = async () => {
    try {
      setLoading(true);
      const [nextItems, nextGroups, nextUnits] = await Promise.all([
        getInventoryItems(),
        getItemGroups(),
        getUnits()
      ]);
      setItems(nextItems);
      setGroups(nextGroups);
      setUnits(nextUnits);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được hàng hóa."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");

    return items.filter((item) => {
      const matchesSearch =
        !keyword ||
        item.name.toLocaleLowerCase("vi").includes(keyword) ||
        (item.note ?? "").toLocaleLowerCase("vi").includes(keyword);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && item.is_active) ||
        (statusFilter === "inactive" && !item.is_active);

      const matchesGroup =
        groupFilter === "all" || item.item_group_id === groupFilter;

      return matchesSearch && matchesStatus && matchesGroup;
    });
  }, [items, search, statusFilter, groupFilter]);

  const activeGroups = groups.filter((group) => group.is_active);
  const activeUnits = units.filter((unit) => unit.is_active);

  const unitLabel = (unitId: number) =>
    units.find((unit) => unit.id === unitId)?.name ?? "đơn vị";

  const ensureSmallestRow = (
    rows: ConversionDraft[],
    smallestUnitId: number
  ): ConversionDraft[] => {
    const withoutSmallest = rows.filter((row) => row.unit_id !== smallestUnitId);
    return [
      ...withoutSmallest,
      {
        unit_id: smallestUnitId,
        quantity_in_smallest_unit: 1,
        is_active: true
      }
    ];
  };

  const ensureDefaultRow = (
    rows: ConversionDraft[],
    defaultUnitId: number,
    smallestUnitId: number
  ): ConversionDraft[] => {
    if (defaultUnitId === smallestUnitId) {
      return ensureSmallestRow(rows, smallestUnitId);
    }

    if (rows.some((row) => row.unit_id === defaultUnitId)) {
      return rows.map((row) =>
        row.unit_id === defaultUnitId ? { ...row, is_active: true } : row
      );
    }

    return [
      ...rows,
      {
        unit_id: defaultUnitId,
        quantity_in_smallest_unit: null,
        is_active: true
      }
    ];
  };

  const openQuickGroup = () => {
    quickGroupForm.resetFields();
    quickGroupForm.setFieldsValue({ is_active: true });
    setQuickGroupOpen(true);
  };

  const saveQuickGroup = async () => {
    try {
      const values = await quickGroupForm.validateFields();
      setQuickSaving(true);
      const created = await createItemGroup({
        name: values.name.trim(),
        note: values.note?.trim() || null,
        is_active: true
      });
      const nextGroups = await getItemGroups();
      setGroups(nextGroups);
      form.setFieldValue("item_group_id", created.id);
      setQuickGroupOpen(false);
      quickGroupForm.resetFields();
      messageApi.success("Đã thêm nhóm hàng hóa.");
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setQuickSaving(false);
    }
  };

  const openQuickUnit = () => {
    quickUnitForm.resetFields();
    quickUnitForm.setFieldsValue({ is_active: true });
    setQuickUnitOpen(true);
  };

  const saveQuickUnit = async () => {
    try {
      const values = await quickUnitForm.validateFields();
      setQuickSaving(true);
      const created = await createUnit({
        name: values.name.trim(),
        is_active: true
      });
      const nextUnits = await getUnits();
      setUnits(nextUnits);

      form.setFieldValue("default_unit_id", created.id);
      const currentSmallest = form.getFieldValue("smallest_unit_id") as number | undefined;
      if (!currentSmallest) {
        form.setFieldValue("smallest_unit_id", created.id);
        setConversions([
          {
            unit_id: created.id,
            quantity_in_smallest_unit: 1,
            is_active: true
          }
        ]);
      } else {
        setConversions((rows) =>
          ensureDefaultRow(rows, created.id, currentSmallest)
        );
      }

      setQuickUnitOpen(false);
      quickUnitForm.resetFields();
      messageApi.success("Đã thêm đơn vị tính.");
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setQuickSaving(false);
    }
  };

  const openCreate = () => {
    const firstGroup = activeGroups[0]?.id;
    const firstUnit = activeUnits[0]?.id;

    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({
      item_group_id: firstGroup,
      default_unit_id: firstUnit,
      smallest_unit_id: firstUnit,
      is_active: true
    });
    setConversions(
      firstUnit
        ? [{
            unit_id: firstUnit,
            quantity_in_smallest_unit: 1,
            is_active: true
          }]
        : []
    );
    setModalOpen(true);
  };

  const openEdit = (item: InventoryItem) => {
    setEditingItem(item);
    form.setFieldsValue({
      name: item.name,
      item_group_id: item.item_group_id,
      default_unit_id: item.default_unit_id,
      smallest_unit_id: item.smallest_unit_id,
      note: item.note ?? "",
      is_active: item.is_active
    });
    setConversions(
      item.conversions.map((conversion) => ({
        unit_id: conversion.unit_id,
        quantity_in_smallest_unit: conversion.quantity_in_smallest_unit,
        is_active: conversion.is_active
      }))
    );
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingItem(null);
    setConversions([]);
    form.resetFields();
  };

  const handleSmallestUnitChange = (smallestUnitId: number) => {
    const defaultUnitId = form.getFieldValue("default_unit_id") as number | undefined;
    let next: ConversionDraft[] = [
      {
        unit_id: smallestUnitId,
        quantity_in_smallest_unit: 1,
        is_active: true
      }
    ];

    if (defaultUnitId) {
      next = ensureDefaultRow(next, defaultUnitId, smallestUnitId);
    }

    setConversions(next);
  };

  const handleDefaultUnitChange = (defaultUnitId: number) => {
    const smallestUnitId = form.getFieldValue("smallest_unit_id") as number | undefined;
    if (!smallestUnitId) {
      return;
    }

    setConversions((rows) =>
      ensureDefaultRow(rows, defaultUnitId, smallestUnitId)
    );
  };

  const addConversion = () => {
    const used = new Set(conversions.map((row) => row.unit_id));
    const available = activeUnits.find((unit) => !used.has(unit.id));

    if (!available) {
      messageApi.info("Không còn đơn vị nào để thêm quy đổi.");
      return;
    }

    setConversions((rows) => [
      ...rows,
      {
        unit_id: available.id,
        quantity_in_smallest_unit: null,
        is_active: true
      }
    ]);
  };

  const updateConversion = (
    index: number,
    patch: Partial<ConversionDraft>
  ) => {
    setConversions((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      )
    );
  };

  const removeConversion = (index: number) => {
    const defaultUnitId = form.getFieldValue("default_unit_id") as number | undefined;
    const smallestUnitId = form.getFieldValue("smallest_unit_id") as number | undefined;
    const row = conversions[index];

    if (
      row.unit_id === defaultUnitId ||
      row.unit_id === smallestUnitId
    ) {
      messageApi.warning("Không thể xóa đơn vị mặc định hoặc đơn vị nhỏ nhất.");
      return;
    }

    setConversions((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  };

  const saveItem = async () => {
    try {
      const values = await form.validateFields();
      const normalized = ensureDefaultRow(
        ensureSmallestRow(conversions, values.smallest_unit_id),
        values.default_unit_id,
        values.smallest_unit_id
      );

      const invalid = normalized.find(
        (row) =>
          row.quantity_in_smallest_unit === null ||
          row.quantity_in_smallest_unit <= 0
      );

      if (invalid) {
        messageApi.error(
          `Nhập hệ số quy đổi cho ${unitLabel(invalid.unit_id)}.`
        );
        return;
      }

      const duplicate = normalized.find(
        (row, index) =>
          normalized.findIndex((candidate) => candidate.unit_id === row.unit_id) !== index
      );

      if (duplicate) {
        messageApi.error("Một đơn vị chỉ được khai báo một lần.");
        return;
      }

      const payload: InventoryItemInput = {
        name: values.name.trim(),
        item_group_id: values.item_group_id,
        default_unit_id: values.default_unit_id,
        smallest_unit_id: values.smallest_unit_id,
        note: values.note?.trim() || null,
        is_active: values.is_active,
        conversions: normalized.map((row) => ({
          unit_id: row.unit_id,
          quantity_in_smallest_unit: row.quantity_in_smallest_unit as number,
          is_active:
            row.unit_id === values.default_unit_id ||
            row.unit_id === values.smallest_unit_id
              ? true
              : row.is_active
        }))
      };

      setSaving(true);

      if (editingItem) {
        await updateInventoryItem(editingItem.id, payload);
        messageApi.success("Đã cập nhật hàng hóa.");
      } else {
        await createInventoryItem(payload);
        messageApi.success("Đã thêm hàng hóa.");
      }

      closeModal();
      await loadData();
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const columns: TableProps<InventoryItem>["columns"] = [
    {
      title: "Tên hàng hóa",
      dataIndex: "name",
      key: "name",
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: "Nhóm hàng hóa",
      dataIndex: "item_group_name",
      key: "item_group_name",
      width: 180
    },
    {
      title: "Đơn vị mặc định",
      dataIndex: "default_unit_name",
      key: "default_unit_name",
      width: 160
    },
    {
      title: "Đơn vị nhỏ nhất",
      dataIndex: "smallest_unit_name",
      key: "smallest_unit_name",
      width: 160
    },
    {
      title: "Trạng thái",
      dataIndex: "is_active",
      key: "is_active",
      width: 160,
      render: (isActive: boolean) =>
        isActive ? (
          <Tag color="success">Đang sử dụng</Tag>
        ) : (
          <Tag>Ngừng sử dụng</Tag>
        )
    },
    {
      title: "Thao tác",
      key: "action",
      width: 100,
      render: (_, item) => (
        <Button type="link" onClick={() => openEdit(item)}>
          Sửa
        </Button>
      )
    }
  ];

  const missingMasterData = activeGroups.length === 0 || activeUnits.length === 0;
  const selectedSmallestUnitId = form.getFieldValue("smallest_unit_id") as number | undefined;
  const selectedDefaultUnitId = form.getFieldValue("default_unit_id") as number | undefined;

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Hàng hóa</Title>
          <Text type="secondary">
            Dữ liệu cơ bản của hàng hóa, nhóm và quy đổi đơn vị. Giá nhập, giá bán,
            cost và tồn kho được quản lý ở nghiệp vụ riêng.
          </Text>
        </div>

        <Button
          type="primary"
          size="large"
          onClick={openCreate}
          disabled={missingMasterData}
        >
          + Thêm hàng hóa
        </Button>
      </div>

      {missingMasterData && (
        <Card className="item-master-warning" size="small">
          <Text type="warning">
            Cần có ít nhất một Nhóm hàng hóa và một Đơn vị tính đang sử dụng
            trước khi thêm hàng hóa.
          </Text>
        </Card>
      )}

      <div className="toolbar item-toolbar">
        <Input.Search
          allowClear
          placeholder="Tìm hàng hóa..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="search-box"
        />

        <Select<number | "all">
          value={groupFilter}
          onChange={setGroupFilter}
          className="status-filter"
          options={[
            { value: "all", label: "Tất cả nhóm" },
            ...groups.map((group) => ({
              value: group.id,
              label: group.is_active ? group.name : `${group.name} (ngừng)`
            }))
          ]}
        />

        <Select<StatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          className="status-filter"
          options={[
            { value: "all", label: "Tất cả trạng thái" },
            { value: "active", label: "Đang sử dụng" },
            { value: "inactive", label: "Ngừng sử dụng" }
          ]}
        />
      </div>

      <div className="table-card">
        <Table<InventoryItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredItems}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: "Chưa có hàng hóa." }}
        />
      </div>

      <Modal
        open={modalOpen}
        width={665}
        title={editingItem ? "Sửa hàng hóa" : "Thêm hàng hóa"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        onCancel={closeModal}
        onOk={() => void saveItem()}
      >
        <Form<InventoryItemForm>
          form={form}
          layout="vertical"
          className="item-form"
        >
          <Form.Item
            label="Tên hàng hóa"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "Nhập tên hàng hóa." },
              { max: 150, message: "Tên hàng hóa tối đa 150 ký tự." }
            ]}
          >
            <Input placeholder="Ví dụ: Ốc hương, Bia Tiger..." autoFocus />
          </Form.Item>

          <div className="item-form-grid">
            <Form.Item label="Nhóm hàng hóa" required>
              <div className="inline-master-field">
                <Form.Item
                  name="item_group_id"
                  noStyle
                  rules={[{ required: true, message: "Chọn nhóm hàng hóa." }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={groups.map((group) => ({
                      value: group.id,
                      label: group.is_active ? group.name : `${group.name} (ngừng sử dụng)`,
                      disabled: !group.is_active && editingItem?.item_group_id !== group.id
                    }))}
                  />
                </Form.Item>
                <Button
                  className="quick-add-button"
                  icon={<PlusOutlined />}
                  onClick={openQuickGroup}
                  title="Thêm nhanh nhóm hàng hóa"
                />
              </div>
            </Form.Item>

            <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
              <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng" />
            </Form.Item>

            <Form.Item
              label="Đơn vị mặc định"
              tooltip="Phiếu nhập và các chức năng sẽ mặc định chọn đơn vị này, nhưng người dùng có thể đổi đơn vị."
              required
            >
              <div className="inline-master-field">
                <Form.Item
                  name="default_unit_id"
                  noStyle
                  rules={[{ required: true, message: "Chọn đơn vị mặc định." }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    onChange={handleDefaultUnitChange}
                    options={units.map((unit) => ({
                      value: unit.id,
                      label: unit.is_active ? unit.name : `${unit.name} (ngừng sử dụng)`,
                      disabled: !unit.is_active && editingItem?.default_unit_id !== unit.id
                    }))}
                  />
                </Form.Item>
                <Button
                  className="quick-add-button"
                  icon={<PlusOutlined />}
                  onClick={openQuickUnit}
                  title="Thêm nhanh đơn vị tính"
                />
              </div>
            </Form.Item>

            <Form.Item
              label="Đơn vị nhỏ nhất"
              name="smallest_unit_id"
              tooltip="Tồn kho, định lượng và cost sẽ quy đổi về đơn vị này; số lượng sẽ hiển thị theo đơn vị nhỏ nhất."
              rules={[{ required: true, message: "Chọn đơn vị nhỏ nhất." }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                onChange={handleSmallestUnitChange}
                options={units.map((unit) => ({
                  value: unit.id,
                  label: unit.is_active ? unit.name : `${unit.name} (ngừng sử dụng)`,
                  disabled: !unit.is_active && editingItem?.smallest_unit_id !== unit.id
                }))}
              />
            </Form.Item>
          </div>

          <Form.Item
            label="Ghi chú"
            name="note"
            rules={[{ max: 500, message: "Ghi chú tối đa 500 ký tự." }]}
          >
            <TextArea rows={3} maxLength={500} showCount placeholder="Không bắt buộc..." />
          </Form.Item>
        </Form>

        <div className="conversion-section">
          <div className="conversion-heading">
            <div>
              <Text strong>Quy đổi đơn vị</Text>
              <div>
                <Text type="secondary">
                  Mỗi đơn vị được quy đổi về đơn vị nhỏ nhất. Đơn vị nhỏ nhất luôn = 1.
                </Text>
              </div>
            </div>
            <Button onClick={addConversion}>+ Thêm quy đổi</Button>
          </div>

          <div className="conversion-list">
            {conversions.map((row, index) => {
              const isSmallest = row.unit_id === selectedSmallestUnitId;
              const isDefault = row.unit_id === selectedDefaultUnitId;
              const usedByOtherRows = new Set(
                conversions
                  .filter((_, rowIndex) => rowIndex !== index)
                  .map((candidate) => candidate.unit_id)
              );

              return (
                <div className="conversion-row" key={`${row.unit_id}-${index}`}>
                  <Select
                    value={row.unit_id}
                    disabled={isSmallest || isDefault}
                    showSearch
                    optionFilterProp="label"
                    onChange={(unitId) =>
                      updateConversion(index, { unit_id: unitId })
                    }
                    options={units.map((unit) => ({
                      value: unit.id,
                      label: unit.name,
                      disabled:
                        usedByOtherRows.has(unit.id) ||
                        (!unit.is_active && unit.id !== row.unit_id)
                    }))}
                  />

                  <div className="conversion-factor">
                    <Text type="secondary">1 {unitLabel(row.unit_id)} =</Text>
                    <InputNumber
                      min={0.000001}
                      step="any"
                      value={row.quantity_in_smallest_unit}
                      disabled={isSmallest}
                      onChange={(value) =>
                        updateConversion(index, {
                          quantity_in_smallest_unit:
                            typeof value === "number" ? value : null
                        })
                      }
                    />
                    <Text>{selectedSmallestUnitId ? unitLabel(selectedSmallestUnitId) : ""}</Text>
                  </div>

                  <Switch
                    checked={row.is_active}
                    disabled={isSmallest || isDefault}
                    onChange={(checked) =>
                      updateConversion(index, { is_active: checked })
                    }
                  />

                  <Button
                    danger
                    disabled={isSmallest || isDefault}
                    onClick={() => removeConversion(index)}
                  >
                    Xóa
                  </Button>
                </div>
              );
            })}
          </div>

          {selectedDefaultUnitId &&
            selectedSmallestUnitId &&
            selectedDefaultUnitId !== selectedSmallestUnitId && (
              <div className="conversion-example">
                <Text type="secondary">
                  Ví dụ: nếu đơn vị mặc định là thùng và đơn vị nhỏ nhất là lon,
                  khai báo 1 thùng = 24 lon.
                </Text>
              </div>
            )}
        </div>

        <div className="item-cost-note">
          <Text type="secondary">
            Giá nhập, giá bán, giá vốn và số lượng tồn không lưu tại đây.
          </Text>
        </div>

        {editingItem && (
          <div className="item-delete-note">
            <Text type="secondary">
              Hàng hóa không xóa; khi không còn dùng hãy chuyển sang trạng thái Ngừng sử dụng.
            </Text>
          </div>
        )}
      </Modal>

      <Modal
        open={quickGroupOpen}
        width={420}
        title="Thêm nhóm hàng hóa nhanh"
        okText="Thêm"
        cancelText="Hủy"
        confirmLoading={quickSaving}
        onCancel={() => setQuickGroupOpen(false)}
        onOk={() => void saveQuickGroup()}
      >
        <Form<GroupForm>
          form={quickGroupForm}
          layout="vertical"
          initialValues={{ is_active: true }}
          className="quick-master-form"
        >
          <Form.Item
            label="Tên nhóm hàng hóa"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "Nhập tên nhóm hàng hóa." },
              { max: 150, message: "Tên nhóm tối đa 150 ký tự." }
            ]}
          >
            <Input autoFocus placeholder="Ví dụ: Gia vị, Đồ uống..." />
          </Form.Item>
          <Form.Item
            label="Ghi chú"
            name="note"
            rules={[{ max: 500, message: "Ghi chú tối đa 500 ký tự." }]}
          >
            <TextArea rows={2} placeholder="Không bắt buộc..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={quickUnitOpen}
        width={390}
        title="Thêm đơn vị nhanh"
        okText="Thêm"
        cancelText="Hủy"
        confirmLoading={quickSaving}
        onCancel={() => setQuickUnitOpen(false)}
        onOk={() => void saveQuickUnit()}
      >
        <Form<UnitForm>
          form={quickUnitForm}
          layout="vertical"
          initialValues={{ is_active: true }}
          className="quick-master-form"
        >
          <Form.Item
            label="Tên đơn vị"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "Nhập tên đơn vị tính." },
              { max: 100, message: "Tên đơn vị tối đa 100 ký tự." }
            ]}
          >
            <Input autoFocus placeholder="Ví dụ: kg, g, chai, lon..." />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function ItemGroupsPage() {
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ItemGroup | null>(null);
  const [form] = Form.useForm<GroupForm>();
  const [messageApi, messageContext] = message.useMessage();

  const loadGroups = async () => {
    try {
      setLoading(true);
      setGroups(await getItemGroups());
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được dữ liệu."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGroups();
  }, []);

  const filteredGroups = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");

    return groups.filter((group) => {
      const matchesSearch =
        !keyword ||
        group.name.toLocaleLowerCase("vi").includes(keyword) ||
        (group.note ?? "").toLocaleLowerCase("vi").includes(keyword);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && group.is_active) ||
        (statusFilter === "inactive" && !group.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [groups, search, statusFilter]);

  const openCreate = () => {
    setEditingGroup(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  };

  const openEdit = (group: ItemGroup) => {
    setEditingGroup(group);
    form.setFieldsValue({
      name: group.name,
      note: group.note ?? "",
      is_active: group.is_active
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingGroup(null);
    form.resetFields();
  };

  const saveGroup = async () => {
    const values = await form.validateFields();

    const payload: ItemGroupInput = {
      name: values.name.trim(),
      note: values.note?.trim() || null,
      is_active: values.is_active
    };

    try {
      setSaving(true);

      if (editingGroup) {
        await updateItemGroup(editingGroup.id, payload);
        messageApi.success("Đã cập nhật nhóm hàng hóa.");
      } else {
        await createItemGroup(payload);
        messageApi.success("Đã thêm nhóm hàng hóa.");
      }

      closeModal();
      await loadGroups();
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được dữ liệu."
      );
    } finally {
      setSaving(false);
    }
  };

  const columns: TableProps<ItemGroup>["columns"] = [
    {
      title: "Tên nhóm",
      dataIndex: "name",
      key: "name",
      width: "24%",
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: "Ghi chú",
      dataIndex: "note",
      key: "note",
      render: (note: string | null) => note || <Text type="secondary">—</Text>
    },
    {
      title: "Trạng thái",
      dataIndex: "is_active",
      key: "is_active",
      width: 170,
      render: (isActive: boolean) =>
        isActive ? (
          <Tag color="success">Đang sử dụng</Tag>
        ) : (
          <Tag>Ngừng sử dụng</Tag>
        )
    },
    {
      title: "Thao tác",
      key: "action",
      width: 110,
      render: (_, group) => (
        <Button type="link" onClick={() => openEdit(group)}>
          Sửa
        </Button>
      )
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Nhóm hàng hóa</Title>
          <Text type="secondary">Quản lý nhóm nguyên vật liệu và hàng hóa.</Text>
        </div>

        <Button type="primary" size="large" onClick={openCreate}>
          + Thêm nhóm
        </Button>
      </div>

      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="Tìm kiếm nhóm hàng hóa..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="search-box"
        />

        <Select<StatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          className="status-filter"
          options={[
            { value: "all", label: "Tất cả trạng thái" },
            { value: "active", label: "Đang sử dụng" },
            { value: "inactive", label: "Ngừng sử dụng" }
          ]}
        />
      </div>

      <div className="table-card">
        <Table<ItemGroup>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredGroups}
          pagination={false}
          locale={{ emptyText: "Chưa có nhóm hàng hóa." }}
        />
      </div>

      <Modal
        open={modalOpen}
        title={editingGroup ? "Sửa nhóm hàng hóa" : "Thêm nhóm hàng hóa"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        onCancel={closeModal}
        onOk={() => void saveGroup()}
      >
        <Form<GroupForm>
          form={form}
          layout="vertical"
          initialValues={{ is_active: true }}
          className="group-form"
        >
          <Form.Item
            label="Tên nhóm"
            name="name"
            rules={[
              { required: true, message: "Nhập tên nhóm hàng hóa." },
              { max: 100, message: "Tên nhóm tối đa 100 ký tự." }
            ]}
          >
            <Input placeholder="Ví dụ: Hải sản" autoFocus />
          </Form.Item>

          <Form.Item
            label="Ghi chú"
            name="note"
            rules={[{ max: 500, message: "Ghi chú tối đa 500 ký tự." }]}
          >
            <TextArea
              rows={4}
              placeholder="Ghi chú không bắt buộc..."
              showCount
              maxLength={500}
            />
          </Form.Item>

          <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
            <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng" />
          </Form.Item>
        </Form>

        {editingGroup && (
          <Space>
            <Text type="secondary">Nhóm hàng hóa không có chức năng xóa.</Text>
          </Space>
        )}
      </Modal>
    </>
  );
}



function UnitsPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [form] = Form.useForm<UnitForm>();
  const [messageApi, messageContext] = message.useMessage();

  const loadUnits = async () => {
    try {
      setLoading(true);
      setUnits(await getUnits());
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được đơn vị tính."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUnits();
  }, []);

  const filteredUnits = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");

    return units.filter((unit) => {
      const matchesSearch =
        !keyword || unit.name.toLocaleLowerCase("vi").includes(keyword);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && unit.is_active) ||
        (statusFilter === "inactive" && !unit.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [units, search, statusFilter]);

  const openCreate = () => {
    setEditingUnit(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  };

  const openEdit = (unit: Unit) => {
    setEditingUnit(unit);
    form.setFieldsValue({
      name: unit.name,
      is_active: unit.is_active
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingUnit(null);
    form.resetFields();
  };

  const saveUnit = async () => {
    try {
      const values = await form.validateFields();
      const payload: UnitInput = {
        name: values.name.trim(),
        is_active: values.is_active
      };

      setSaving(true);

      if (editingUnit) {
        await updateUnit(editingUnit.id, payload);
        messageApi.success("Đã cập nhật đơn vị tính.");
      } else {
        await createUnit(payload);
        messageApi.success("Đã thêm đơn vị tính.");
      }

      closeModal();
      await loadUnits();
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const columns: TableProps<Unit>["columns"] = [
    {
      title: "Tên đơn vị",
      dataIndex: "name",
      key: "name",
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: "Trạng thái",
      dataIndex: "is_active",
      key: "is_active",
      width: 170,
      render: (isActive: boolean) =>
        isActive ? (
          <Tag color="success">Đang sử dụng</Tag>
        ) : (
          <Tag>Ngừng sử dụng</Tag>
        )
    },
    {
      title: "Thao tác",
      key: "action",
      width: 110,
      render: (_, unit) => (
        <Button type="link" onClick={() => openEdit(unit)}>
          Sửa
        </Button>
      )
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Đơn vị tính</Title>
          <Text type="secondary">
            Quản lý đơn vị sử dụng cho hàng hóa và nguyên vật liệu.
          </Text>
        </div>

        <Button type="primary" size="large" onClick={openCreate}>
          + Thêm đơn vị
        </Button>
      </div>

      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="Tìm đơn vị tính..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="search-box"
        />

        <Select<StatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          className="status-filter"
          options={[
            { value: "all", label: "Tất cả trạng thái" },
            { value: "active", label: "Đang sử dụng" },
            { value: "inactive", label: "Ngừng sử dụng" }
          ]}
        />
      </div>

      <div className="table-card">
        <Table<Unit>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredUnits}
          pagination={false}
          locale={{ emptyText: "Chưa có đơn vị tính." }}
        />
      </div>

      <Modal
        open={modalOpen}
        title={editingUnit ? "Sửa đơn vị tính" : "Thêm đơn vị tính"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        onCancel={closeModal}
        onOk={() => void saveUnit()}
      >
        <Form<UnitForm>
          form={form}
          layout="vertical"
          initialValues={{ is_active: true }}
          className="group-form"
        >
          <Form.Item
            label="Tên đơn vị"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "Nhập tên đơn vị tính." },
              { max: 100, message: "Tên đơn vị tối đa 100 ký tự." }
            ]}
          >
            <Input placeholder="Ví dụ: kg, con, chai, lon..." autoFocus />
          </Form.Item>

          <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
            <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng" />
          </Form.Item>
        </Form>

        {editingUnit && (
          <Space>
            <Text type="secondary">Đơn vị tính không có chức năng xóa.</Text>
          </Space>
        )}
      </Modal>
    </>
  );
}

function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<SupplierMode>("view");
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const [form] = Form.useForm<SupplierForm>();
  const [messageApi, messageContext] = message.useMessage();

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      setSuppliers(await getSuppliers());
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được nhà cung cấp."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSuppliers();
  }, []);

  const filteredSuppliers = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");
    if (!keyword) {
      return suppliers;
    }

    return suppliers.filter((supplier) =>
      supplier.name.toLocaleLowerCase("vi").includes(keyword)
    );
  }, [suppliers, search]);

  const openCreate = () => {
    setSelectedSupplier(null);
    setMode("create");
    setQrPreview(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openView = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setMode("view");
    setQrPreview(supplier.payment_qr_image);
    form.setFieldsValue({
      name: supplier.name,
      phone: supplier.phone ?? undefined,
      address: supplier.address ?? undefined,
      note: supplier.note ?? undefined,
      bank_name: supplier.bank_name ?? undefined,
      bank_account_number: supplier.bank_account_number ?? undefined,
      bank_account_name: supplier.bank_account_name ?? undefined,
      payment_qr_image: supplier.payment_qr_image
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedSupplier(null);
    setQrPreview(null);
    form.resetFields();
  };

  const cleanOptional = (value?: string | null) => {
    const cleaned = value?.trim() ?? "";
    return cleaned || null;
  };

  const saveSupplier = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const payload: SupplierInput = {
        name: values.name.trim(),
        phone: cleanOptional(values.phone),
        address: cleanOptional(values.address),
        note: cleanOptional(values.note),
        bank_name: cleanOptional(values.bank_name),
        bank_account_number: cleanOptional(values.bank_account_number),
        bank_account_name: cleanOptional(values.bank_account_name),
        payment_qr_image: values.payment_qr_image ?? qrPreview
      };

      const saved =
        mode === "edit" && selectedSupplier
          ? await updateSupplier(selectedSupplier.id, payload)
          : await createSupplier(payload);

      await loadSuppliers();
      setSelectedSupplier(saved);
      setMode("view");
      setQrPreview(saved.payment_qr_image);
      form.setFieldsValue({
        name: saved.name,
        phone: saved.phone ?? undefined,
        address: saved.address ?? undefined,
        note: saved.note ?? undefined,
        bank_name: saved.bank_name ?? undefined,
        bank_account_number: saved.bank_account_number ?? undefined,
        bank_account_name: saved.bank_account_name ?? undefined,
        payment_qr_image: saved.payment_qr_image
      });
      messageApi.success(
        mode === "edit" ? "Đã cập nhật nhà cung cấp." : "Đã thêm nhà cung cấp."
      );
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!selectedSupplier || !selectedSupplier.can_delete) {
      return;
    }

    Modal.confirm({
      title: "Xóa nhà cung cấp?",
      content: `Nhà cung cấp "${selectedSupplier.name}" sẽ bị xóa khỏi danh sách.`,
      okText: "Xóa",
      cancelText: "Hủy",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteSupplier(selectedSupplier.id);
          closeModal();
          await loadSuppliers();
          messageApi.success("Đã xóa nhà cung cấp.");
        } catch (error) {
          messageApi.error(
            error instanceof Error ? error.message : "Không xóa được nhà cung cấp."
          );
        }
      }
    });
  };

  const onQrFile = (file: File | undefined) => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      messageApi.error("Vui lòng chọn file ảnh.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      setQrPreview(result);
      form.setFieldValue("payment_qr_image", result);
    };
    reader.readAsDataURL(file);
  };

  const removeQr = () => {
    setQrPreview(null);
    form.setFieldValue("payment_qr_image", null);
  };

  const columns: TableProps<Supplier>["columns"] = [
    {
      title: "Tên nhà cung cấp",
      dataIndex: "name",
      key: "name",
      render: (name: string) => <Text strong>{name}</Text>
    }
  ];

  const modalTitle =
    mode === "create"
      ? "Thêm nhà cung cấp"
      : mode === "edit"
        ? "Sửa nhà cung cấp"
        : "Thông tin nhà cung cấp";

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Nhà cung cấp</Title>
          <Text type="secondary">
            Danh sách tối giản; bấm vào tên để xem đầy đủ thông tin.
          </Text>
        </div>

        <Button type="primary" size="large" onClick={openCreate}>
          + Thêm nhà cung cấp
        </Button>
      </div>

      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="Tìm theo tên nhà cung cấp..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="search-box"
        />
      </div>

      <div className="table-card">
        <Table<Supplier>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredSuppliers}
          pagination={false}
          locale={{ emptyText: "Chưa có nhà cung cấp." }}
          onRow={(supplier) => ({
            onClick: () => openView(supplier),
            className: "supplier-row"
          })}
        />
      </div>

      <Modal
        open={modalOpen}
        width={650}
        title={modalTitle}
        onCancel={closeModal}
        footer={
          mode === "view" ? (
            <div className="supplier-modal-footer">
              <div>
                {selectedSupplier && (
                  <Button
                    danger
                    disabled={!selectedSupplier.can_delete}
                    onClick={confirmDelete}
                  >
                    Xóa
                  </Button>
                )}
              </div>
              <Space>
                <Button onClick={closeModal}>Đóng</Button>
                <Button type="primary" onClick={() => setMode("edit")}>
                  Sửa
                </Button>
              </Space>
            </div>
          ) : (
            <Space>
              <Button
                onClick={() => {
                  if (selectedSupplier) {
                    openView(selectedSupplier);
                  } else {
                    closeModal();
                  }
                }}
              >
                Hủy
              </Button>
              <Button
                type="primary"
                loading={saving}
                onClick={() => void saveSupplier()}
              >
                Lưu
              </Button>
            </Space>
          )
        }
      >
        <Form<SupplierForm>
          form={form}
          layout="vertical"
          disabled={mode === "view"}
          className="supplier-form"
        >
          <Form.Item
            label="Tên nhà cung cấp"
            name="name"
            rules={[
              {
                required: true,
                whitespace: true,
                message: "Nhập tên nhà cung cấp."
              }
            ]}
          >
            <Input placeholder="Tên nhà cung cấp" autoFocus={mode === "create"} />
          </Form.Item>

          <div className="supplier-form-grid">
            <Form.Item label="Số điện thoại" name="phone">
              <Input placeholder="Số điện thoại" />
            </Form.Item>

            <Form.Item label="Ngân hàng" name="bank_name">
              <Input placeholder="Tên ngân hàng" />
            </Form.Item>

            <Form.Item label="Số tài khoản" name="bank_account_number">
              <Input placeholder="Số tài khoản" />
            </Form.Item>

            <Form.Item label="Tên chủ tài khoản" name="bank_account_name">
              <Input placeholder="Tên chủ tài khoản" />
            </Form.Item>
          </div>

          <Form.Item label="Địa chỉ" name="address">
            <TextArea rows={2} placeholder="Địa chỉ" />
          </Form.Item>

          <Form.Item label="Ghi chú" name="note">
            <TextArea rows={3} placeholder="Ghi chú" />
          </Form.Item>

          <Form.Item name="payment_qr_image" hidden>
            <Input />
          </Form.Item>

          <Form.Item label="QR thanh toán">
            <div className="supplier-qr-box">
              {qrPreview ? (
                <img
                  src={qrPreview}
                  alt="QR thanh toán"
                  className="supplier-qr-preview"
                />
              ) : (
                <div className="supplier-qr-empty">Chưa có ảnh QR</div>
              )}

              {mode !== "view" && (
                <Space wrap>
                  <label className="supplier-file-label">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        onQrFile(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                    <span className="ant-btn ant-btn-default">
                      {qrPreview ? "Chọn ảnh khác" : "Tải ảnh QR"}
                    </span>
                  </label>

                  {qrPreview && (
                    <Button onClick={removeQr}>Xóa ảnh QR</Button>
                  )}
                </Space>
              )}
            </div>
          </Form.Item>
        </Form>

        {mode === "view" && selectedSupplier && !selectedSupplier.can_delete && (
          <Text type="secondary" className="supplier-delete-note">
            Không thể xóa vì nhà cung cấp đã có dữ liệu nghiệp vụ liên kết.
          </Text>
        )}
      </Modal>
    </>
  );
}

function BackupSettingsPage() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [messageApi, messageContext] = message.useMessage();

  const loadStatus = async () => {
    try {
      setLoading(true);
      setStatus(await getBackupStatus());
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không đọc được trạng thái sao lưu."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const doAction = async (
    action: () => Promise<BackupStatus>,
    successMessage: string
  ) => {
    try {
      setWorking(true);
      const next = await action();
      setStatus(next);
      messageApi.success(successMessage);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không thực hiện được sao lưu."
      );
    } finally {
      setWorking(false);
    }
  };

  const latestText = status?.latest_backup
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "medium"
      }).format(new Date(status.latest_backup))
    : "Chưa có";

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Cài đặt</Title>
          <Text type="secondary">
            Sao lưu database OC11 tự động và đồng bộ qua Google Drive Desktop.
          </Text>
        </div>
      </div>

      <Card
        className="backup-settings-card"
        loading={loading}
        title="Sao lưu dữ liệu"
        extra={
          status?.google_drive_configured ? (
            <Tag color="success">Google Drive đã cấu hình</Tag>
          ) : (
            <Tag color="warning">Đang sao lưu local</Tag>
          )
        }
      >
        <div className="backup-status-grid">
          <div>
            <Text type="secondary">Thư mục sao lưu</Text>
            <div className="backup-path">
              <Text code>{status?.folder ?? "—"}</Text>
            </div>
          </div>

          <div>
            <Text type="secondary">Lần sao lưu gần nhất</Text>
            <div><Text strong>{latestText}</Text></div>
          </div>

          <div>
            <Text type="secondary">Số bản theo ngày</Text>
            <div><Text strong>{status?.daily_backup_count ?? 0}</Text></div>
          </div>

          <div>
            <Text type="secondary">Trạng thái</Text>
            <div>
              {status?.last_error ? (
                <Tag color="error">Có lỗi sao lưu</Tag>
              ) : status?.latest_file_exists ? (
                <Tag color="success">Hoạt động</Tag>
              ) : (
                <Tag>Chưa có bản sao</Tag>
              )}
            </div>
          </div>
        </div>

        {status?.last_error && (
          <div className="backup-error">
            <Text type="danger">{status.last_error}</Text>
          </div>
        )}

        <div className="backup-explain">
          <Text>
            Sau mỗi lần dữ liệu được ghi thành công, OC11 cập nhật
            <Text strong> oc11_latest.db</Text> và một bản
            <Text strong> oc11_YYYY-MM-DD.db</Text>. Khi thư mục này nằm trong
            Google Drive Desktop, Google Drive sẽ tự đồng bộ các file lên cloud.
          </Text>
        </div>

        <Space wrap>
          <Button
            type="primary"
            loading={working}
            onClick={() =>
              void doAction(
                selectBackupFolder,
                "Đã chọn thư mục Google Drive và sao lưu dữ liệu."
              )
            }
          >
            Chọn thư mục Google Drive
          </Button>

          <Button
            loading={working}
            onClick={() =>
              void doAction(runBackup, "Đã sao lưu dữ liệu ngay.")
            }
          >
            Sao lưu ngay
          </Button>

          <Button
            loading={working}
            onClick={() =>
              void doAction(
                useLocalBackupFolder,
                "Đã chuyển về thư mục sao lưu local."
              )
            }
          >
            Dùng thư mục local
          </Button>
        </Space>
      </Card>
    </>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <Card className="placeholder-page">
      <Title level={2}>{title}</Title>
      <Text type="secondary">
        Chức năng này chưa được triển khai. Ốc 11 sẽ xây theo quy trình
        IDEA → DATABASE → UI → IMPLEMENT → TEST → LOCK.
      </Text>
    </Card>
  );
}

const pageTitles: Record<string, string> = {
  "sales-pos": "Bán hàng",
  "sales-orders": "Đơn bán hàng",
  "item-list": "Danh sách hàng hóa",
  "units": "Đơn vị tính",
  "menu-items": "Món thực đơn",
  "menu-groups": "Nhóm thực đơn",
  "menu-cost": "Kiểu chế biến & Cost",
  "purchase-orders": "Phiếu nhập",
  "suppliers": "Nhà cung cấp",
  stock: "Tồn kho thực tế",
  "stock-sales": "Kho tiêu thụ",
  "fund-accounts": "Quỹ tiền mặt & tài khoản ngân hàng",
  "money-ledgers": "Sổ tiền mặt - Sổ tiền gửi",
  "cash-categories": "Loại thu/chi",
  "report-revenue": "Báo cáo doanh thu",
  "report-stock": "Báo cáo tồn kho",
  "report-purchases": "Báo cáo nhập hàng",
  "report-cash": "Báo cáo thu chi",
  "report-profit": "Báo cáo lợi nhuận",
  settings: "Cài đặt"
};

function App() {
  const [page, setPage] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(true);
  const [voucherPrefill, setVoucherPrefill] = useState<VoucherPrefill | null>(null);
  const [linkedPurchaseReceiptId, setLinkedPurchaseReceiptId] = useState<number | null>(null);
  const [editingSaleOrder, setEditingSaleOrder] = useState<SaleOrder | null>(null);
  const today = new Intl.DateTimeFormat("vi-VN").format(new Date());

  const renderPage = () => {
    if (page === "dashboard") {
      return <Dashboard onNavigate={setPage} />;
    }

    if (page === "sales-pos") {
      return (
        <SalesPosPage
          editingOrder={editingSaleOrder}
          onEditDone={() => {
            setEditingSaleOrder(null);
            setPage("sales-orders");
          }}
          onOpenOrders={() => {
            setEditingSaleOrder(null);
            setPage("sales-orders");
          }}
        />
      );
    }

    if (page === "sales-orders") {
      return (
        <SalesOrdersPage
          onEditOrder={(order) => {
            setEditingSaleOrder(order);
            setPage("sales-pos");
          }}
        />
      );
    }

    if (page === "item-list") {
      return <InventoryItemsPage />;
    }

    if (page === "item-groups") {
      return <ItemGroupsPage />;
    }

    if (page === "units") {
      return <UnitsPage />;
    }

    if (page === "suppliers") {
      return <SuppliersPage />;
    }

    if (page === "menu-items") {
      return <MenuItemsPage />;
    }

    if (page === "menu-groups") {
      return <MenuGroupsPage />;
    }

    if (page === "menu-cost") {
      return <CostRecipesPage />;
    }

    if (page === "purchase-orders") {
      return (
        <PurchaseOrdersPage
          onPayDebt={(prefill) => {
            setVoucherPrefill(prefill);
            setPage("money-ledgers");
          }}
          initialReceiptId={linkedPurchaseReceiptId}
          onInitialReceiptConsumed={() => setLinkedPurchaseReceiptId(null)}
        />
      );
    }

    if (page === "stock") {
      return <InventoryStockPage />;
    }

    if (page === "stock-sales") {
      return <ConsumptionPage />;
    }

    if (page === "fund-accounts") {
      return (
        <Tabs
          defaultActiveKey="cash"
          items={[
            {
              key: "cash",
              label: "Quỹ tiền mặt",
              children: <CashFundsPage />
            },
            {
              key: "bank",
              label: "Tài khoản ngân hàng",
              children: <BankAccountsPage />
            }
          ]}
        />
      );
    }

    if (page === "money-ledgers") {
      const openSourceDocument = (sourceType: string, sourceId: string) => {
        if (sourceType !== "PURCHASE_RECEIPT") {
          return;
        }

        const receiptId = Number(sourceId);
        if (Number.isInteger(receiptId) && receiptId > 0) {
          setLinkedPurchaseReceiptId(receiptId);
          setPage("purchase-orders");
        }
      };

      return (
        <Tabs
          defaultActiveKey="cash"
          items={[
            {
              key: "cash",
              label: "Sổ tiền mặt",
              children: (
                <CashLedgerPage
                  initialVoucher={voucherPrefill}
                  onInitialVoucherConsumed={() => setVoucherPrefill(null)}
                  onOpenSourceDocument={openSourceDocument}
                />
              )
            },
            {
              key: "bank",
              label: "Sổ tiền gửi",
              children: (
                <BankLedgerPage
                  initialVoucher={voucherPrefill}
                  onInitialVoucherConsumed={() => setVoucherPrefill(null)}
                  onOpenSourceDocument={openSourceDocument}
                />
              )
            }
          ]}
        />
      );
    }

    if (page === "cash-categories") {
      return <FundTransactionCategoriesPage />;
    }

    if (page === "settings") {
      return (
        <Tabs
          defaultActiveKey="tables"
          items={[
            {
              key: "tables",
              label: "Khu vực & bàn",
              children: <RestaurantTablesSettings />
            },
            {
              key: "printer",
              label: "Máy in bếp",
              children: <KitchenPrinterSettings />
            },
            {
              key: "backup",
              label: "Sao lưu dữ liệu",
              children: <BackupSettingsPage />
            }
          ]}
        />
      );
    }

    return <PlaceholderPage title={pageTitles[page] ?? "Ốc 11"} />;
  };

  return (
    <Layout className="app-shell">
      <Sider
        width={202}
        collapsedWidth={58}
        className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}
        collapsible
        collapsed={collapsed}
        trigger={null}
      >
        <BrandLogo collapsed={collapsed} />

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          items={menuItems}
          onClick={({ key }) => setPage(key)}
          className="main-menu"
        />
      </Sider>

      <Layout>
        <Header className="topbar">
          <div className="topbar-left">
            <Button
              type="text"
              className="sidebar-toggle"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? "Mở thanh menu" : "Thu gọn thanh menu"}
            />
            <Text strong className="topbar-title">
              {page === "dashboard" ? "Tổng quan" : pageTitles[page] ?? "Ốc 11 Manager"}
            </Text>
          </div>

          <div className="topbar-right">
            <div className="today-chip">
              <CalendarOutlined />
              <span>Hôm nay: {today}</span>
            </div>
            <div className="manager-chip">
              <span className="manager-avatar"><UserOutlined /></span>
              <Text strong>Quản lý</Text>
            </div>
          </div>
        </Header>

        <Content className="content">{renderPage()}</Content>
      </Layout>
    </Layout>
  );
}

export default App;
