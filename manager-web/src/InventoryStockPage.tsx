import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography
} from "antd";
import type { TableProps } from "antd";

import {
  createStocktakeBatch,
  getInventoryItemHistory,
  getInventoryStock,
  getItemGroups,
  setItemStockTracking
} from "./api";
import type {
  InventoryItemHistory,
  InventoryMovement,
  InventoryStock,
  ItemGroup,
  StocktakeBatchInput
} from "./types";

const { Title, Text } = Typography;

type HistoryFilter = "ALL" | "PURCHASE" | "SALE" | "ADJUSTMENT" | "OTHER";
type TrackingFilter = "TRACKED" | "UNTRACKED" | "ALL";

function newSyncId() {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

type AdjustmentForm = {
  actual_quantity: number;
  reason?: string;
  note?: string;
};

function number(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 3
  }).format(value);
}

function money(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0
  }).format(value);
}

function todayInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStartInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(parsed);
}

function signed(value: number) {
  if (value > 0) return `+${number(value)}`;
  return number(value);
}

export default function InventoryStockPage() {
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<number | "all">("all");
  const [trackingFilter, setTrackingFilter] = useState<TrackingFilter>("TRACKED");
  const [trackingSavingId, setTrackingSavingId] = useState<number | null>(null);
  const [asOf, setAsOf] = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<InventoryStock | null>(null);
  const [history, setHistory] = useState<InventoryItemHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFrom, setHistoryFrom] = useState(monthStartInput());
  const [historyTo, setHistoryTo] = useState(todayInput());
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("ALL");

  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentItem, setAdjustmentItem] = useState<InventoryStock | null>(null);
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [singleSyncId, setSingleSyncId] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<Record<number, number | undefined>>({});
  const [bulkPending, setBulkPending] = useState<StocktakeBatchInput | null>(null);
  const [adjustmentForm] = Form.useForm<AdjustmentForm>();
  const actualQuantity = Form.useWatch("actual_quantity", adjustmentForm);

  const [messageApi, messageContext] = message.useMessage();

  const loadStock = async () => {
    try {
      setLoading(true);
      const data = await getInventoryStock({
        search: search || undefined,
        group_id: groupFilter === "all" ? undefined : groupFilter,
        as_of: asOf || undefined,
        tracking: trackingFilter
      });
      setStocks(data);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được tồn kho."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const [nextGroups, nextStock] = await Promise.all([
          getItemGroups(),
          getInventoryStock({ tracking: "TRACKED" })
        ]);
        setGroups(nextGroups);
        setStocks(nextStock);
      } catch (error) {
        messageApi.error(
          error instanceof Error ? error.message : "Không tải được dữ liệu tồn kho."
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadHistory = async (
    itemId: number,
    from = historyFrom,
    to = historyTo,
    type = historyFilter
  ) => {
    try {
      setHistoryLoading(true);
      setHistory(
        await getInventoryItemHistory(itemId, {
          from,
          to,
          type
        })
      );
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được lịch sử tồn kho."
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = async (row: InventoryStock) => {
    setHistoryItem(row);
    setHistoryFrom(monthStartInput());
    setHistoryTo(todayInput());
    setHistoryFilter("ALL");
    setHistoryOpen(true);
    await loadHistory(row.item_id, monthStartInput(), todayInput(), "ALL");
  };

  const openAdjustment = (row: InventoryStock) => {
    if (asOf || !row.is_stock_tracked) return;
    setSingleSyncId(newSyncId());
    setAdjustmentItem(row);
    adjustmentForm.resetFields();
    adjustmentForm.setFieldsValue({
      actual_quantity: row.stock_quantity,
      reason: "Đối chiếu tồn"
    });
    setAdjustmentOpen(true);
  };

  const saveAdjustment = async () => {
    if (!adjustmentItem) return;

    try {
      const values = await adjustmentForm.validateFields();
      setAdjustmentSaving(true);

      const payload: StocktakeBatchInput = {
        client_sync_id: singleSyncId,
        reason: values.reason?.trim() || "Đối chiếu tồn",
        note: values.note?.trim() || undefined,
        items: [{
          item_id: adjustmentItem.item_id,
          expected_quantity: adjustmentItem.stock_quantity,
          expected_revision: adjustmentItem.stock_revision,
          actual_quantity: values.actual_quantity
        }]
      };

      const created = await createStocktakeBatch(payload);
      const line = created.items[0];
      messageApi.success(
        line.quantity_delta === 0
          ? "Đã ghi nhận mốc đối chiếu. Tồn thực tế khớp dữ liệu."
          : `Đã đối chiếu tồn, chênh lệch ${signed(line.quantity_delta)} ${line.smallest_unit_name}.`
      );

      setAdjustmentOpen(false);
      setAdjustmentItem(null);
      await loadStock();

      if (historyItem?.item_id === line.item_id && historyOpen) {
        await loadHistory(line.item_id);
      }
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setAdjustmentSaving(false);
    }
  };

  const toggleTracking = async (row: InventoryStock, enabled: boolean) => {
    try {
      setTrackingSavingId(row.item_id);
      await setItemStockTracking(row.item_id, enabled);
      messageApi.success(enabled ? "Đã bật theo dõi kho." : "Đã ngừng theo dõi kho.");
      await loadStock();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không cập nhật được theo dõi kho.");
    } finally {
      setTrackingSavingId(null);
    }
  };

  const openBulk = () => {
    if (asOf) return;
    setBulkDraft({});
    setBulkPending(null);
    setBulkOpen(true);
  };

  const saveBulk = async () => {
    const rows = stocks.filter((row) =>
      row.is_stock_tracked && bulkDraft[row.item_id] !== undefined
    );
    if (!bulkPending && rows.length === 0) {
      messageApi.warning("Nhập số thực tế cho ít nhất một mặt hàng.");
      return;
    }
    const request: StocktakeBatchInput = bulkPending ?? {
      client_sync_id: newSyncId(),
      reason: "Kiểm kho trên web",
      items: rows.map((row) => ({
        item_id: row.item_id,
        expected_quantity: row.stock_quantity,
        expected_revision: row.stock_revision,
        actual_quantity: bulkDraft[row.item_id] as number
      }))
    };
    // Reuse the exact same payload after a connection timeout.
    setBulkPending(request);
    try {
      setBulkSaving(true);
      const created = await createStocktakeBatch(request);
      messageApi.success(`Đã lưu kiểm kho ${created.items.length} mặt hàng (${created.adjustment_code}).`);
      setBulkOpen(false);
      setBulkPending(null);
      setBulkDraft({});
      await loadStock();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không lưu được kiểm kho. Có thể thử gửi lại.");
    } finally {
      setBulkSaving(false);
    }
  };

  const stockCount = stocks.length;
  const negativeCount = useMemo(
    () => stocks.filter((row) => row.stock_quantity < 0).length,
    [stocks]
  );
  const zeroCount = useMemo(
    () => stocks.filter((row) => Math.abs(row.stock_quantity) < 1e-9).length,
    [stocks]
  );

  const columns: TableProps<InventoryStock>["columns"] = [
    {
      title: "Hàng hóa",
      dataIndex: "item_name",
      key: "item_name",
      minWidth: 190,
      render: (value: string, row) => (
        <Button
          type="link"
          className="stock-item-link"
          onClick={() => void openHistory(row)}
        >
          {value}
        </Button>
      )
    },
    {
      title: "Nhóm",
      dataIndex: "item_group_name",
      key: "item_group_name",
      width: 150
    },
    {
      title: "Tồn theo dữ liệu",
      dataIndex: "stock_quantity",
      key: "stock_quantity",
      width: 145,
      align: "right",
      sorter: (a, b) => a.stock_quantity - b.stock_quantity,
      defaultSortOrder: "ascend",
      render: (value: number) => (
        <Text
          strong
          type={value < 0 ? "danger" : undefined}
          className="stock-quantity"
        >
          {number(value)}
        </Text>
      )
    },
    {
      title: "ĐVT",
      dataIndex: "smallest_unit_name",
      key: "smallest_unit_name",
      width: 90
    },
    {
      title: "Giá nhập gần nhất",
      key: "last_purchase_price",
      width: 160,
      align: "right",
      render: (_, row) =>
        row.last_purchase_unit_price === null ? (
          <Text type="secondary">—</Text>
        ) : (
          <div className="stock-price-cell">
            <Text>{money(row.last_purchase_unit_price)} đ</Text>
            <Text type="secondary">/{row.last_purchase_unit_name}</Text>
          </div>
        )
    },
    {
      title: "Lần nhập cuối",
      key: "last_purchase_time",
      width: 145,
      render: (_, row) => (
        <div className="stock-date-cell">
          <Text>{formatDateTime(row.last_purchase_time)}</Text>
          {row.last_purchase_receipt_code && (
            <Text type="secondary">{row.last_purchase_receipt_code}</Text>
          )}
        </div>
      )
    },
    {
      title: "Đối chiếu gần nhất",
      key: "last_reconciled_at",
      width: 155,
      render: (_, row) =>
        row.last_reconciled_at ? (
          <div className="stock-date-cell">
            <Text>{formatDateTime(row.last_reconciled_at)}</Text>
            <Text type="secondary">
              {number(row.last_reconciled_quantity ?? 0)} {row.smallest_unit_name}
            </Text>
          </div>
        ) : (
          <Text type="secondary">Chưa đối chiếu</Text>
        )
    },
    {
      title: "Theo dõi",
      key: "is_stock_tracked",
      width: 120,
      render: (_, row) => (
        <Switch
          size="small"
          checked={row.is_stock_tracked}
          loading={trackingSavingId === row.item_id}
          disabled={trackingSavingId !== null}
          onChange={(checked) => void toggleTracking(row, checked)}
          checkedChildren="Bật"
          unCheckedChildren="Tắt"
        />
      )
    },
    {
      title: "Thao tác",
      key: "action",
      width: 150,
      fixed: "right",
      render: (_, row) => (
        <Space size={2}>
          <Button type="link" onClick={() => void openHistory(row)}>
            Lịch sử
          </Button>
          <Button
            type="link"
            disabled={Boolean(asOf) || !row.is_stock_tracked}
            onClick={() => openAdjustment(row)}
          >
            Đối chiếu
          </Button>
        </Space>
      )
    }
  ];

  const historyColumns: TableProps<InventoryMovement>["columns"] = [
    {
      title: "Thời gian",
      dataIndex: "movement_time",
      key: "movement_time",
      width: 145,
      render: (value: string) => formatDateTime(value)
    },
    {
      title: "Nghiệp vụ",
      dataIndex: "movement_label",
      key: "movement_label",
      width: 130,
      render: (value: string, row) => {
        const color =
          row.movement_kind === "PURCHASE"
            ? "green"
            : row.movement_kind === "SALE"
              ? "blue"
              : row.movement_kind === "ADJUSTMENT"
                ? "gold"
                : undefined;
        return <Tag color={color}>{value}</Tag>;
      }
    },
    {
      title: "Chứng từ",
      dataIndex: "reference_code",
      key: "reference_code",
      width: 130,
      render: (value: string | null) => value || <Text type="secondary">—</Text>
    },
    {
      title: "Biến động",
      dataIndex: "quantity_delta",
      key: "quantity_delta",
      width: 120,
      align: "right",
      render: (value: number) => (
        <Text strong type={value < 0 ? "danger" : value > 0 ? "success" : undefined}>
          {signed(value)}
        </Text>
      )
    },
    {
      title: "Tồn sau",
      dataIndex: "running_quantity",
      key: "running_quantity",
      width: 115,
      align: "right",
      render: (value: number) => <Text strong>{number(value)}</Text>
    },
    {
      title: "Ghi chú",
      dataIndex: "note",
      key: "note",
      render: (value: string | null) => value || <Text type="secondary">—</Text>
    }
  ];

  const adjustmentDifference =
    adjustmentItem && typeof actualQuantity === "number"
      ? actualQuantity - adjustmentItem.stock_quantity
      : 0;

  return (
    <>
      {messageContext}

      <div className="page-heading stock-page-heading">
        <div>
          <Title level={2}>Tồn kho thực tế</Title>
          <Text type="secondary">
            Số tồn được tính theo dữ liệu nhập hàng, bán hàng và các lần đối chiếu thực tế.
          </Text>
        </div>
      </div>

      <div className="stock-summary-grid">
        <Card size="small">
          <Statistic title="Mặt hàng" value={stockCount} />
        </Card>
        <Card size="small">
          <Statistic title="Đang bằng 0" value={zeroCount} />
        </Card>
        <Card size="small">
          <Statistic
            title="Tồn âm cần kiểm tra"
            value={negativeCount}
            valueStyle={negativeCount > 0 ? { color: "#cf1322" } : undefined}
          />
        </Card>
      </div>

      <div className="toolbar stock-toolbar">
        <Button type="primary" onClick={openBulk} disabled={Boolean(asOf)}>
          + Kiểm kho nhiều mặt hàng
        </Button>
        <Input.Search
          allowClear
          placeholder="Tìm mặt hàng..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onSearch={() => void loadStock()}
          className="search-box"
        />

        <Select<number | "all">
          value={groupFilter}
          onChange={setGroupFilter}
          style={{ minWidth: 190 }}
          options={[
            { value: "all", label: "Tất cả nhóm" },
            ...groups.map((group) => ({
              value: group.id,
              label: group.name
            }))
          ]}
        />

        <Select<TrackingFilter>
          value={trackingFilter}
          onChange={setTrackingFilter}
          style={{ minWidth: 180 }}
          options={[
            { value: "TRACKED", label: "Đang theo dõi" },
            { value: "UNTRACKED", label: "Ngừng theo dõi" },
            { value: "ALL", label: "Tất cả hàng hóa" }
          ]}
        />

        <Input
          type="date"
          value={asOf}
          onChange={(event) => setAsOf(event.target.value)}
          style={{ width: 155 }}
          title="Để trống để xem tồn hiện tại"
        />

        <Button type="primary" onClick={() => void loadStock()}>
          Lấy dữ liệu
        </Button>

        {(search || groupFilter !== "all" || trackingFilter !== "TRACKED" || asOf) && (
          <Button
            onClick={() => {
              setSearch("");
              setGroupFilter("all");
              setTrackingFilter("TRACKED");
              setAsOf("");
              void (async () => {
                try {
                  setLoading(true);
                  setStocks(await getInventoryStock({ tracking: "TRACKED" }));
                } finally {
                  setLoading(false);
                }
              })();
            }}
          >
            Bỏ lọc
          </Button>
        )}

        <Text type="secondary" className="stock-asof-hint">
          {asOf ? `Tồn đến hết ngày ${asOf}` : "Tồn hiện tại"}
        </Text>
      </div>

      <div className="table-card">
        <Table<InventoryStock>
          rowKey="item_id"
          loading={loading}
          columns={columns}
          dataSource={stocks}
          pagination={{ pageSize: 40, showSizeChanger: false }}
          scroll={{ x: 1200 }}
          locale={{ emptyText: "Chưa có dữ liệu tồn kho." }}
        />
      </div>

      <Modal
        open={bulkOpen}
        title="Kiểm kho nhiều mặt hàng"
        width="min(950px, 96vw)"
        okText={bulkPending ? "Thử đồng bộ lại" : "Lưu kiểm kho"}
        cancelText="Đóng"
        confirmLoading={bulkSaving}
        onOk={() => void saveBulk()}
        onCancel={() => {
          setBulkOpen(false);
          setBulkDraft({});
          setBulkPending(null);
        }}
      >
        <Text type="secondary">
          Nhập số lượng đếm được vào các ô cần kiểm. Để trống những mặt hàng chưa kiểm.
          Chỉ những dòng đã nhập mới được ghi vào phiếu kiểm kho. Đơn vị là đơn vị nhỏ nhất.
        </Text>
        {bulkPending && (
          <div style={{ marginTop: 12 }}>
            <Text type="warning">
              Đã thử gửi phiếu này. Giữ nguyên dữ liệu để gửi lại an toàn nếu mất kết nối.
              Muốn sửa số đếm, đóng phiếu và tải tồn kho mới trước khi kiểm lại.
            </Text>
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <Table<InventoryStock>
            rowKey="item_id"
            size="small"
            pagination={{ pageSize: 30 }}
            scroll={{ y: 440 }}
            dataSource={stocks.filter((row) => row.is_stock_tracked)}
            columns={[
              { title: "Hàng hóa", dataIndex: "item_name", key: "item_name" },
              {
                title: "Tồn hệ thống",
                key: "system",
                width: 150,
                align: "right",
                render: (_, row) => `${number(row.stock_quantity)} ${row.smallest_unit_name}`
              },
              {
                title: "Thực tế đếm được",
                key: "actual",
                width: 155,
                render: (_, row) => (
                  <InputNumber<number>
                    min={0}
                    step="any"
                    placeholder="Chưa kiểm"
                    style={{ width: "100%" }}
                    disabled={bulkPending !== null || bulkSaving}
                    value={bulkDraft[row.item_id]}
                    onChange={(value) =>
                      setBulkDraft((previous) => ({ ...previous, [row.item_id]: value ?? undefined }))
                    }
                  />
                )
              },
              {
                title: "Chênh lệch",
                key: "difference",
                width: 135,
                align: "right",
                render: (_, row) =>
                  bulkDraft[row.item_id] === undefined
                    ? "—"
                    : `${signed((bulkDraft[row.item_id] as number) - row.stock_quantity)} ${row.smallest_unit_name}`
              }
            ]}
          />
        </div>
      </Modal>

      <Modal
        open={historyOpen}
        width="min(1120px, 96vw)"
        title={
          historyItem
            ? `Lịch sử tồn kho - ${historyItem.item_name}`
            : "Lịch sử tồn kho"
        }
        footer={<Button onClick={() => setHistoryOpen(false)}>Đóng</Button>}
        onCancel={() => setHistoryOpen(false)}
        className="stock-history-modal"
      >
        <div className="stock-history-toolbar">
          <div>
            <Text type="secondary">Từ ngày</Text>
            <Input
              type="date"
              value={historyFrom}
              onChange={(event) => setHistoryFrom(event.target.value)}
            />
          </div>
          <div>
            <Text type="secondary">Đến ngày</Text>
            <Input
              type="date"
              value={historyTo}
              onChange={(event) => setHistoryTo(event.target.value)}
            />
          </div>
          <div>
            <Text type="secondary">Nghiệp vụ</Text>
            <Select<HistoryFilter>
              value={historyFilter}
              onChange={setHistoryFilter}
              options={[
                { value: "ALL", label: "Tất cả" },
                { value: "PURCHASE", label: "Nhập hàng" },
                { value: "SALE", label: "Bán hàng" },
                { value: "ADJUSTMENT", label: "Đối chiếu tồn" },
                { value: "OTHER", label: "Khác" }
              ]}
            />
          </div>
          <Button
            type="primary"
            loading={historyLoading}
            disabled={!historyItem}
            onClick={() => {
              if (historyItem) {
                void loadHistory(historyItem.item_id);
              }
            }}
          >
            Lấy dữ liệu
          </Button>
        </div>

        {history && (
          <>
            <div className="stock-history-summary">
              <div>
                <Text type="secondary">Tồn đầu kỳ</Text>
                <strong>{number(history.summary.opening_quantity)}</strong>
              </div>
              <div>
                <Text type="secondary">Nhập trong kỳ</Text>
                <strong>{signed(history.summary.purchase_delta)}</strong>
              </div>
              <div>
                <Text type="secondary">Xuất bán</Text>
                <strong>{signed(history.summary.sales_delta)}</strong>
              </div>
              <div>
                <Text type="secondary">Đối chiếu</Text>
                <strong>{signed(history.summary.adjustment_delta)}</strong>
              </div>
              <div className="stock-history-closing">
                <Text type="secondary">Tồn cuối kỳ</Text>
                <strong>
                  {number(history.summary.closing_quantity)} {history.smallest_unit_name}
                </strong>
              </div>
            </div>

            <div className="table-card">
              <Table<InventoryMovement>
                rowKey="id"
                size="small"
                loading={historyLoading}
                columns={historyColumns}
                dataSource={history.items}
                pagination={false}
                scroll={{ x: 850, y: 420 }}
                locale={{ emptyText: "Không có biến động trong khoảng thời gian này." }}
              />
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={adjustmentOpen}
        title={
          adjustmentItem
            ? `Đối chiếu tồn - ${adjustmentItem.item_name}`
            : "Đối chiếu tồn"
        }
        width={520}
        okText="Xác nhận"
        cancelText="Hủy"
        confirmLoading={adjustmentSaving}
        onCancel={() => {
          setAdjustmentOpen(false);
          setAdjustmentItem(null);
        }}
        onOk={() => void saveAdjustment()}
      >
        {adjustmentItem && (
          <>
            <div className="stock-adjustment-current">
              <div>
                <Text type="secondary">Tồn theo dữ liệu</Text>
                <strong>
                  {number(adjustmentItem.stock_quantity)} {adjustmentItem.smallest_unit_name}
                </strong>
              </div>
              <div>
                <Text type="secondary">Chênh lệch</Text>
                <strong className={adjustmentDifference < 0 ? "stock-negative" : ""}>
                  {signed(adjustmentDifference)} {adjustmentItem.smallest_unit_name}
                </strong>
              </div>
            </div>

            <Form<AdjustmentForm>
              form={adjustmentForm}
              layout="vertical"
              className="stock-adjustment-form"
            >
              <Form.Item
                label={`Tồn thực tế (${adjustmentItem.smallest_unit_name})`}
                required
              >
                <Space.Compact style={{ width: "100%" }}>
                  <Form.Item
                    name="actual_quantity"
                    noStyle
                    rules={[
                      { required: true, message: "Nhập số lượng thực tế." },
                      {
                        type: "number",
                        min: 0,
                        message: "Tồn thực tế không được âm."
                      }
                    ]}
                  >
                    <InputNumber<number>
                      min={0}
                      step="any"
                      style={{ width: "100%" }}
                      autoFocus
                    />
                  </Form.Item>
                  <Button
                    onClick={() => adjustmentForm.setFieldValue("actual_quantity", 0)}
                  >
                    Hết hàng
                  </Button>
                </Space.Compact>
              </Form.Item>

              <Form.Item label="Lý do" name="reason">
                <Input placeholder="Đối chiếu tồn" />
              </Form.Item>

              <Form.Item label="Ghi chú" name="note">
                <Input.TextArea
                  rows={3}
                  placeholder="Không bắt buộc..."
                  maxLength={500}
                />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </>
  );
}
