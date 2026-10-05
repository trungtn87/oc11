import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Select,
  Switch,
  Table,
  Tabs,
  Typography,
  message
} from "antd";
import type { TableProps } from "antd";

import {
  getConsumptionSummary,
  getItemGroups,
  getMenuItems,
  previewConsumption
} from "./api";
import type {
  ConsumptionBreakdownItem,
  ConsumptionPreview,
  ConsumptionSummaryItem,
  ItemGroup,
  MenuItem
} from "./types";

const { Title, Text } = Typography;

function localDate(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function monthStart() {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

function today() {
  return localDate(new Date());
}

function formatQty(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 3
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export default function ConsumptionPage() {
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState<number | undefined>();
  const [showAll, setShowAll] = useState(false);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [rows, setRows] = useState<ConsumptionSummaryItem[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedMenuItemId, setSelectedMenuItemId] = useState<number>();
  const [selectedOptionId, setSelectedOptionId] = useState<number>();
  const [previewQty, setPreviewQty] = useState(1);
  const [preview, setPreview] = useState<ConsumptionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [messageApi, messageContext] = message.useMessage();

  const loadMasters = async () => {
    try {
      const [groupRows, menuRows] = await Promise.all([
        getItemGroups(),
        getMenuItems()
      ]);
      setGroups(groupRows);
      setMenuItems(menuRows);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được dữ liệu."
      );
    }
  };

  const loadSummary = async () => {
    try {
      setLoading(true);
      const response = await getConsumptionSummary({
        from: fromDate,
        to: toDate,
        search,
        group_id: groupId
      });
      setRows(response.items);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được kho tiêu thụ."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMasters();
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [fromDate, toDate, groupId]);

  const visibleRows = useMemo(
    () => (showAll ? rows : rows.filter((row) => row.consumed_quantity > 0)),
    [rows, showAll]
  );

  const selectedMenuItem = menuItems.find(
    (item) => item.id === selectedMenuItemId
  );

  const runPreview = async () => {
    if (!selectedOptionId || previewQty <= 0) {
      messageApi.error("Chọn món, kiểu chế biến và số lượng.");
      return;
    }

    try {
      setPreviewLoading(true);
      setPreview(
        await previewConsumption({
          menu_item_option_id: selectedOptionId,
          quantity: previewQty
        })
      );
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không bung được định lượng."
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const summaryColumns: TableProps<ConsumptionSummaryItem>["columns"] = [
    {
      title: "Hàng hóa",
      dataIndex: "item_name",
      key: "item_name",
      render: (value: string) => <Text strong>{value}</Text>
    },
    {
      title: "Nhóm",
      dataIndex: "item_group_name",
      key: "item_group_name",
      width: 170
    },
    {
      title: "Tiêu thụ theo định lượng",
      dataIndex: "consumed_quantity",
      key: "consumed_quantity",
      width: 190,
      render: (value: number, row) => (
        <Text strong>
          {formatQty(value)} {row.smallest_unit_name}
        </Text>
      )
    },
    {
      title: "Số dòng bán",
      dataIndex: "sale_line_count",
      key: "sale_line_count",
      width: 110
    },
    {
      title: "Bán gần nhất",
      dataIndex: "last_sale_time",
      key: "last_sale_time",
      width: 165,
      render: formatDateTime
    },
    {
      title: "Tồn hệ thống",
      dataIndex: "stock_quantity",
      key: "stock_quantity",
      width: 150,
      render: (value: number, row) =>
        formatQty(value) + " " + row.smallest_unit_name
    },
    {
      title: "Đối chiếu gần nhất",
      dataIndex: "last_reconciled_at",
      key: "last_reconciled_at",
      width: 170,
      render: formatDateTime
    }
  ];

  const previewColumns: TableProps<ConsumptionBreakdownItem>["columns"] = [
    {
      title: "Nguyên liệu kho",
      dataIndex: "item_name",
      key: "item_name",
      render: (value: string) => <Text strong>{value}</Text>
    },
    {
      title: "Nhóm",
      dataIndex: "item_group_name",
      key: "item_group_name"
    },
    {
      title: "Lượng tiêu thụ",
      dataIndex: "quantity",
      key: "quantity",
      width: 190,
      render: (value: number, row) => (
        <Text strong>
          {formatQty(value)} {row.smallest_unit_name}
        </Text>
      )
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Kho tiêu thụ</Title>
          <Text type="secondary">
            Theo dõi nguyên liệu tiêu thụ từ món bán sau khi bung định lượng 2 tầng.
          </Text>
        </div>
      </div>

      <Tabs
        defaultActiveKey="summary"
        items={[
          {
            key: "summary",
            label: "Tiêu thụ theo hàng hóa",
            children: (
              <>
                <Card size="small" className="consumption-filter-card">
                  <div className="consumption-filters">
                    <label>
                      <Text type="secondary">Từ ngày</Text>
                      <Input
                        type="date"
                        value={fromDate}
                        onChange={(event) => setFromDate(event.target.value)}
                      />
                    </label>

                    <label>
                      <Text type="secondary">Đến ngày</Text>
                      <Input
                        type="date"
                        value={toDate}
                        onChange={(event) => setToDate(event.target.value)}
                      />
                    </label>

                    <label>
                      <Text type="secondary">Nhóm hàng hóa</Text>
                      <Select
                        allowClear
                        value={groupId}
                        placeholder="Tất cả nhóm"
                        style={{ width: "100%" }}
                        options={groups.map((group) => ({
                          value: group.id,
                          label: group.name
                        }))}
                        onChange={setGroupId}
                      />
                    </label>

                    <label className="consumption-search-field">
                      <Text type="secondary">Tìm hàng hóa</Text>
                      <Input.Search
                        allowClear
                        value={search}
                        placeholder="Tên hàng hóa..."
                        onChange={(event) => setSearch(event.target.value)}
                        onSearch={() => void loadSummary()}
                      />
                    </label>

                    <div className="consumption-show-all">
                      <Text type="secondary">Hiện cả hàng chưa tiêu thụ</Text>
                      <Switch checked={showAll} onChange={setShowAll} />
                    </div>

                    <Button type="primary" onClick={() => void loadSummary()}>
                      Xem
                    </Button>
                  </div>
                </Card>

                <Alert
                  type="info"
                  showIcon
                  className="consumption-info"
                  message="Dữ liệu tiêu thụ chỉ phát sinh khi có dữ liệu bán hàng."
                  description="POS sau này chỉ cần gửi món + kiểu chế biến + số lượng; hệ thống sẽ tự bung sốt/bán thành phẩm về nguyên liệu kho và trừ tồn."
                />

                <div className="table-card">
                  <Table<ConsumptionSummaryItem>
                    rowKey="item_id"
                    loading={loading}
                    columns={summaryColumns}
                    dataSource={visibleRows}
                    pagination={false}
                    locale={{
                      emptyText:
                        "Chưa có dữ liệu tiêu thụ trong khoảng thời gian này."
                    }}
                  />
                </div>
              </>
            )
          },
          {
            key: "preview",
            label: "Test bung định lượng",
            children: (
              <>
                <Card size="small" className="consumption-preview-card">
                  <div className="consumption-preview-controls">
                    <label>
                      <Text type="secondary">Món</Text>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        value={selectedMenuItemId}
                        placeholder="Chọn món"
                        style={{ width: "100%" }}
                        options={menuItems.map((item) => ({
                          value: item.id,
                          label: item.name,
                          disabled: !item.is_active
                        }))}
                        onChange={(itemId) => {
                          setSelectedMenuItemId(itemId);
                          setSelectedOptionId(undefined);
                          setPreview(null);
                        }}
                      />
                    </label>

                    <label>
                      <Text type="secondary">Kiểu chế biến</Text>
                      <Select
                        value={selectedOptionId}
                        placeholder="Chọn kiểu chế biến"
                        style={{ width: "100%" }}
                        disabled={!selectedMenuItem}
                        options={(selectedMenuItem?.options ?? []).map(
                          (option) => ({
                            value: option.id,
                            label: option.service_option_name,
                            disabled: !option.is_active
                          })
                        )}
                        onChange={(optionId) => {
                          setSelectedOptionId(optionId);
                          setPreview(null);
                        }}
                      />
                    </label>

                    <label>
                      <Text type="secondary">Số lượng bán</Text>
                      <InputNumber
                        min={0.001}
                        step={1}
                        value={previewQty}
                        style={{ width: "100%" }}
                        onChange={(value) =>
                          setPreviewQty(typeof value === "number" ? value : 1)
                        }
                      />
                    </label>

                    <Button
                      type="primary"
                      loading={previewLoading}
                      onClick={() => void runPreview()}
                    >
                      Bung định lượng
                    </Button>
                  </div>
                </Card>

                {preview && (
                  <>
                    <Alert
                      type="success"
                      showIcon
                      className="consumption-info"
                      message={
                        preview.menu_item_name +
                        " - " +
                        preview.service_option_name +
                        " × " +
                        formatQty(preview.sold_quantity)
                      }
                      description="Kết quả dưới đây là lượng nguyên liệu kho theo định mức, sau khi bung cả tầng món và tầng sốt/bán thành phẩm."
                    />

                    <div className="table-card">
                      <Table<ConsumptionBreakdownItem>
                        rowKey="item_id"
                        columns={previewColumns}
                        dataSource={preview.items}
                        pagination={false}
                      />
                    </div>
                  </>
                )}
              </>
            )
          }
        ]}
      />
    </>
  );
}
