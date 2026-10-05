import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { TableProps } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import {
  acceptCurrentRecipeCost,
  createServiceOptionCost,
  getCostAlerts,
  getCostIngredientPrices,
  getInventoryItems,
  getServiceOptionCosts,
  getUnits,
  updateServiceOptionCost
} from "./api";
import type {
  CostAlert,
  CostIngredientPrice,
  InventoryItem,
  ServiceOptionCost,
  ServiceOptionCostInput,
  Unit
} from "./types";

const { Title, Text } = Typography;
const { TextArea } = Input;

type CostForm = {
  name: string;
  note?: string;
  display_order: number;
  is_active: boolean;
  has_recipe: boolean;
  output_quantity?: number;
  output_unit_id?: number;
  waste_percent: number;
  alert_threshold_percent: number;
};

type RecipeLineDraft = {
  key: string;
  item_id?: number;
  unit_id?: number;
  quantity?: number;
};

function formatCost(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }
  return (
    new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 2
    }).format(value) + " đ"
  );
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }
  return (
    new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 2
    }).format(value) + "%"
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export default function CostRecipesPage() {
  const [options, setOptions] = useState<ServiceOptionCost[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [prices, setPrices] = useState<CostIngredientPrice[]>([]);
  const [alerts, setAlerts] = useState<CostAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acceptingRecipeId, setAcceptingRecipeId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceOptionCost | null>(null);
  const [lines, setLines] = useState<RecipeLineDraft[]>([]);
  const [form] = Form.useForm<CostForm>();
  const [messageApi, messageContext] = message.useMessage();

  const hasRecipe = Form.useWatch("has_recipe", form) ?? false;
  const outputQuantity = Form.useWatch("output_quantity", form);
  const outputUnitId = Form.useWatch("output_unit_id", form);
  const wastePercent = Form.useWatch("waste_percent", form) ?? 0;

  const priceMap = useMemo(
    () => new Map(prices.map((row) => [row.item_id, row])),
    [prices]
  );

  const itemMap = useMemo(
    () => new Map(items.map((row) => [row.id, row])),
    [items]
  );

  const loadData = async () => {
    try {
      setLoading(true);
      const [optionRows, itemRows, unitRows, priceRows, alertRows] =
        await Promise.all([
          getServiceOptionCosts(),
          getInventoryItems(),
          getUnits(),
          getCostIngredientPrices(),
          getCostAlerts()
        ]);
      setOptions(optionRows);
      setItems(itemRows);
      setUnits(unitRows);
      setPrices(priceRows);
      setAlerts(alertRows);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được dữ liệu Cost."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredOptions = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");
    if (!keyword) {
      return options;
    }
    return options.filter((row) =>
      row.name.toLocaleLowerCase("vi").includes(keyword)
    );
  }, [options, search]);

  const lineCalculation = (line: RecipeLineDraft) => {
    if (!line.item_id || !line.unit_id || !line.quantity) {
      return {
        conversionFactor: null as number | null,
        smallestUnitName: "",
        price: null as number | null,
        lineCost: null as number | null
      };
    }

    const item = itemMap.get(line.item_id);
    const conversion = item?.conversions.find(
      (row) => row.unit_id === line.unit_id
    );
    const price = priceMap.get(line.item_id)?.current_price_per_smallest_unit;

    if (!item || !conversion || price === null || price === undefined) {
      return {
        conversionFactor: conversion?.quantity_in_smallest_unit ?? null,
        smallestUnitName: item?.smallest_unit_name ?? "",
        price: price ?? null,
        lineCost: null
      };
    }

    return {
      conversionFactor: conversion.quantity_in_smallest_unit,
      smallestUnitName: item.smallest_unit_name,
      price,
      lineCost:
        line.quantity * conversion.quantity_in_smallest_unit * price
    };
  };

  const preview = useMemo(() => {
    if (!hasRecipe || lines.length === 0) {
      return null;
    }

    const calculations = lines.map(lineCalculation);
    if (calculations.some((row) => row.lineCost === null)) {
      return {
        complete: false,
        baseCost: null,
        totalCost: null,
        unitCost: null
      };
    }

    const baseCost = calculations.reduce(
      (sum, row) => sum + (row.lineCost ?? 0),
      0
    );
    const totalCost = baseCost * (1 + Number(wastePercent || 0) / 100);
    const qty = Number(outputQuantity || 0);

    return {
      complete: qty > 0,
      baseCost,
      totalCost,
      unitCost: qty > 0 ? totalCost / qty : null
    };
  }, [hasRecipe, lines, itemMap, priceMap, outputQuantity, wastePercent]);

  const openCreate = () => {
    setEditing(null);
    setLines([]);
    form.resetFields();
    form.setFieldsValue({
      display_order: 0,
      is_active: true,
      has_recipe: false,
      waste_percent: 5,
      alert_threshold_percent: 5
    });
    setModalOpen(true);
  };

  const openEdit = (row: ServiceOptionCost) => {
    setEditing(row);
    const recipe = row.recipe;
    form.setFieldsValue({
      name: row.name,
      note: row.note ?? undefined,
      display_order: row.display_order,
      is_active: row.is_active,
      has_recipe: Boolean(recipe),
      output_quantity: recipe?.output_quantity,
      output_unit_id: recipe?.output_unit_id,
      waste_percent: recipe?.waste_percent ?? 5,
      alert_threshold_percent: recipe?.alert_threshold_percent ?? 5
    });
    setLines(
      recipe?.items.map((line) => ({
        key: String(line.id),
        item_id: line.item_id,
        unit_id: line.unit_id,
        quantity: line.quantity
      })) ?? []
    );
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setLines([]);
    form.resetFields();
  };

  const addLine = () => {
    setLines((current) => [
      ...current,
      { key: `new-${Date.now()}-${current.length}` }
    ]);
  };

  const updateLine = (key: string, patch: Partial<RecipeLineDraft>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const save = async () => {
    try {
      const values = await form.validateFields();

      if (values.has_recipe && lines.length === 0) {
        messageApi.error("Công thức cần ít nhất 1 nguyên liệu.");
        return;
      }

      if (
        values.has_recipe &&
        lines.some(
          (line) =>
            !line.item_id ||
            !line.unit_id ||
            line.quantity === undefined ||
            line.quantity <= 0
        )
      ) {
        messageApi.error("Điền đủ nguyên liệu, đơn vị và số lượng.");
        return;
      }

      const payload: ServiceOptionCostInput = {
        name: values.name.trim(),
        note: values.note?.trim() || null,
        display_order: values.display_order ?? 0,
        is_active: values.is_active,
        recipe: values.has_recipe
          ? {
              output_quantity: Number(values.output_quantity),
              output_unit_id: Number(values.output_unit_id),
              waste_percent: Number(values.waste_percent ?? 0),
              alert_threshold_percent: Number(
                values.alert_threshold_percent ?? 5
              ),
              is_active: values.is_active,
              items: lines.map((line) => ({
                item_id: Number(line.item_id),
                unit_id: Number(line.unit_id),
                quantity: Number(line.quantity)
              }))
            }
          : null
      };

      setSaving(true);
      if (editing) {
        await updateServiceOptionCost(editing.id, payload);
        messageApi.success("Đã cập nhật kiểu chế biến và Cost.");
      } else {
        await createServiceOptionCost(payload);
        messageApi.success("Đã thêm kiểu chế biến.");
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

  const acceptCurrent = async (recipeId: number) => {
    try {
      setAcceptingRecipeId(recipeId);
      await acceptCurrentRecipeCost(recipeId);
      messageApi.success("Đã dùng Cost hiện tại làm mốc mới.");
      await loadData();
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không cập nhật được mốc Cost."
      );
    } finally {
      setAcceptingRecipeId(null);
    }
  };

  const optionColumns: TableProps<ServiceOptionCost>["columns"] = [
    {
      title: "Kiểu chế biến",
      dataIndex: "name",
      key: "name",
      render: (value: string) => <Text strong>{value}</Text>
    },
    {
      title: "Công thức",
      key: "recipe",
      width: 140,
      render: (_, row) =>
        row.recipe ? <Tag color="blue">Có công thức</Tag> : <Tag>Không</Tag>
    },
    {
      title: "Cost hiện tại",
      key: "current_cost",
      width: 190,
      render: (_, row) =>
        row.recipe ? (
          row.recipe.cost_complete ? (
            <div>
              <Text strong>{formatCost(row.recipe.current_unit_cost)}</Text>
              <Text type="secondary"> / {row.recipe.output_unit_name}</Text>
            </div>
          ) : (
            <Tag color="warning">Thiếu giá nguyên liệu</Tag>
          )
        ) : (
          <Text type="secondary">—</Text>
        )
    },
    {
      title: "Mốc Cost",
      key: "reference",
      width: 170,
      render: (_, row) =>
        row.recipe ? formatCost(row.recipe.reference_unit_cost) : "—"
    },
    {
      title: "Thay đổi",
      key: "change",
      width: 120,
      render: (_, row) => {
        const value = row.recipe?.change_percent;
        if (value === null || value === undefined) {
          return "—";
        }
        return value >= (row.recipe?.alert_threshold_percent ?? 5) ? (
          <Tag color="error">+{formatPercent(value)}</Tag>
        ) : value > 0 ? (
          <Tag color="warning">+{formatPercent(value)}</Tag>
        ) : (
          <Text>{formatPercent(value)}</Text>
        );
      }
    },
    {
      title: "Trạng thái",
      key: "status",
      width: 145,
      render: (_, row) =>
        !row.is_active ? (
          <Tag>Ngừng sử dụng</Tag>
        ) : row.recipe?.has_open_alert ? (
          <Tag color="error">Cảnh báo Cost</Tag>
        ) : (
          <Tag color="success">Đang sử dụng</Tag>
        )
    },
    {
      title: "Thao tác",
      key: "action",
      width: 100,
      render: (_, row) => (
        <Button type="link" onClick={() => openEdit(row)}>
          Sửa
        </Button>
      )
    }
  ];

  const alertColumns: TableProps<CostAlert>["columns"] = [
    {
      title: "Kiểu chế biến / Sốt",
      dataIndex: "service_option_name",
      key: "service_option_name",
      render: (value: string) => <Text strong>{value}</Text>
    },
    {
      title: "Cost mốc",
      dataIndex: "reference_unit_cost",
      key: "reference_unit_cost",
      width: 160,
      render: formatCost
    },
    {
      title: "Cost hiện tại",
      dataIndex: "current_unit_cost",
      key: "current_unit_cost",
      width: 160,
      render: (value: number) => <Text strong>{formatCost(value)}</Text>
    },
    {
      title: "Tăng",
      dataIndex: "change_percent",
      key: "change_percent",
      width: 110,
      render: (value: number) => (
        <Tag color="error">+{formatPercent(value)}</Tag>
      )
    },
    {
      title: "Phát hiện",
      dataIndex: "detected_at",
      key: "detected_at",
      width: 170,
      render: formatDateTime
    },
    {
      title: "Xử lý",
      key: "action",
      width: 190,
      render: (_, row) => (
        <Button
          type="primary"
          ghost
          loading={acceptingRecipeId === row.recipe_id}
          onClick={() => void acceptCurrent(row.recipe_id)}
        >
          Dùng Cost mới làm mốc
        </Button>
      )
    }
  ];

  const ingredientColumns: TableProps<RecipeLineDraft>["columns"] = [
    {
      title: "Nguyên liệu",
      key: "item",
      render: (_, line) => (
        <Select
          showSearch
          optionFilterProp="label"
          value={line.item_id}
          placeholder="Chọn nguyên liệu"
          style={{ width: "100%" }}
          options={items.map((item) => ({
            value: item.id,
            label: item.name,
            disabled: !item.is_active
          }))}
          onChange={(itemId) => {
            const item = itemMap.get(itemId);
            const preferred =
              item?.conversions.find(
                (conversion) => conversion.unit_id === item.default_unit_id
              ) ?? item?.conversions[0];
            updateLine(line.key, {
              item_id: itemId,
              unit_id: preferred?.unit_id,
              quantity: undefined
            });
          }}
        />
      )
    },
    {
      title: "Số lượng",
      key: "quantity",
      width: 130,
      render: (_, line) => (
        <InputNumber
          min={0.000001}
          step="any"
          value={line.quantity}
          style={{ width: "100%" }}
          onChange={(value) =>
            updateLine(line.key, {
              quantity: typeof value === "number" ? value : undefined
            })
          }
        />
      )
    },
    {
      title: "ĐVT",
      key: "unit",
      width: 140,
      render: (_, line) => {
        const item = line.item_id ? itemMap.get(line.item_id) : undefined;
        return (
          <Select
            value={line.unit_id}
            style={{ width: "100%" }}
            placeholder="Đơn vị"
            disabled={!item}
            options={(item?.conversions ?? []).map((conversion) => ({
              value: conversion.unit_id,
              label: conversion.unit_name,
              disabled: !conversion.is_active
            }))}
            onChange={(unitId) => updateLine(line.key, { unit_id: unitId })}
          />
        );
      }
    },
    {
      title: "Giá vốn",
      key: "price",
      width: 170,
      render: (_, line) => {
        const calc = lineCalculation(line);
        if (!line.item_id) {
          return "—";
        }
        if (calc.price === null) {
          return <Tag color="warning">Chưa có giá nhập</Tag>;
        }
        return (
          <Text>
            {formatCost(calc.price)} / {calc.smallestUnitName}
          </Text>
        );
      }
    },
    {
      title: "Thành tiền",
      key: "line_cost",
      width: 150,
      render: (_, line) => {
        const calc = lineCalculation(line);
        return calc.lineCost === null ? "—" : formatCost(calc.lineCost);
      }
    },
    {
      title: "",
      key: "remove",
      width: 70,
      render: (_, line) => (
        <Button danger type="text" onClick={() => removeLine(line.key)}>
          Xóa
        </Button>
      )
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Kiểu chế biến & Cost sốt</Title>
          <Text type="secondary">
            Kiểu hấp, nướng có thể không có công thức. Cost chỉ theo dõi và cảnh báo,
            không tự thay đổi giá bán.
          </Text>
        </div>
        <Button type="primary" size="large" onClick={openCreate}>
          + Thêm kiểu chế biến
        </Button>
      </div>

      {alerts.length > 0 && (
        <Alert
          type="warning"
          showIcon
          className="cost-alert-banner"
          message={`Có ${alerts.length} cảnh báo Cost vượt ngưỡng`}
          description="Giá nguyên liệu mới đã làm Cost sốt tăng vượt mốc đã chốt."
        />
      )}

      <Tabs
        defaultActiveKey="recipes"
        items={[
          {
            key: "recipes",
            label: "Kiểu chế biến / Công thức",
            children: (
              <>
                <div className="toolbar">
                  <Input.Search
                    allowClear
                    placeholder="Tìm kiểu chế biến..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="search-box"
                  />
                </div>

                <div className="table-card">
                  <Table<ServiceOptionCost>
                    rowKey="id"
                    loading={loading}
                    columns={optionColumns}
                    dataSource={filteredOptions}
                    pagination={false}
                    locale={{ emptyText: "Chưa có kiểu chế biến." }}
                  />
                </div>
              </>
            )
          },
          {
            key: "alerts",
            label: alerts.length ? `Cảnh báo Cost (${alerts.length})` : "Cảnh báo Cost",
            children: (
              <div className="table-card">
                <Table<CostAlert>
                  rowKey="id"
                  loading={loading}
                  columns={alertColumns}
                  dataSource={alerts}
                  pagination={false}
                  locale={{ emptyText: "Không có cảnh báo Cost đang mở." }}
                />
              </div>
            )
          }
        ]}
      />

      <Modal
        open={modalOpen}
        width={980}
        title={editing ? "Sửa kiểu chế biến / Cost" : "Thêm kiểu chế biến"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        onCancel={closeModal}
        onOk={() => void save()}
      >
        <Form<CostForm>
          form={form}
          layout="vertical"
          initialValues={{
            display_order: 0,
            is_active: true,
            has_recipe: false,
            waste_percent: 5,
            alert_threshold_percent: 5
          }}
        >
          <div className="cost-master-grid">
            <Form.Item
              label="Tên kiểu chế biến"
              name="name"
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: "Nhập tên kiểu chế biến."
                }
              ]}
            >
              <Input autoFocus placeholder="Ví dụ: Trứng muối, Bơ tỏi, Hấp..." />
            </Form.Item>

            <Form.Item label="Thứ tự" name="display_order">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
              <Switch checkedChildren="Đang dùng" unCheckedChildren="Ngừng" />
            </Form.Item>
          </div>

          <Form.Item label="Ghi chú" name="note">
            <TextArea rows={2} placeholder="Không bắt buộc..." />
          </Form.Item>

          <Card
            size="small"
            className="cost-recipe-card"
            title={
              <Space>
                <Text strong>Công thức sốt / bán thành phẩm</Text>
                <Form.Item
                  name="has_recipe"
                  valuePropName="checked"
                  noStyle
                >
                  <Switch />
                </Form.Item>
              </Space>
            }
          >
            {!hasRecipe ? (
              <Text type="secondary">
                Không có công thức: dùng cho các kiểu như Hấp, Nướng mọi...
              </Text>
            ) : (
              <>
                <div className="cost-recipe-settings">
                  <Form.Item
                    label="Sản lượng thành phẩm"
                    name="output_quantity"
                    rules={[{ required: true, message: "Nhập sản lượng." }]}
                  >
                    <InputNumber min={0.000001} step="any" style={{ width: "100%" }} />
                  </Form.Item>

                  <Form.Item
                    label="Đơn vị thành phẩm"
                    name="output_unit_id"
                    rules={[{ required: true, message: "Chọn đơn vị thành phẩm." }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={units.map((unit) => ({
                        value: unit.id,
                        label: unit.name,
                        disabled: !unit.is_active
                      }))}
                    />
                  </Form.Item>

                  <Form.Item label="Hao phí (%)" name="waste_percent">
                    <InputNumber min={0} max={100} style={{ width: "100%" }} />
                  </Form.Item>

                  <Form.Item
                    label="Cảnh báo khi Cost tăng (%)"
                    name="alert_threshold_percent"
                  >
                    <InputNumber min={0.01} max={100} style={{ width: "100%" }} />
                  </Form.Item>
                </div>

                <div className="cost-recipe-heading">
                  <div>
                    <Text strong>Định lượng nguyên liệu</Text>
                    <div>
                      <Text type="secondary">
                        Giá vốn lấy từ phiếu nhập gần nhất và có phân bổ phí vận chuyển.
                      </Text>
                    </div>
                  </div>
                  <Button icon={<PlusOutlined />} onClick={addLine}>
                    Thêm nguyên liệu
                  </Button>
                </div>

                <Table<RecipeLineDraft>
                  rowKey="key"
                  columns={ingredientColumns}
                  dataSource={lines}
                  pagination={false}
                  size="small"
                  locale={{ emptyText: "Chưa có nguyên liệu." }}
                />

                <div className="cost-summary">
                  <div>
                    <Text type="secondary">Tổng nguyên liệu</Text>
                    <div><Text strong>{formatCost(preview?.baseCost)}</Text></div>
                  </div>
                  <div>
                    <Text type="secondary">Sau hao phí</Text>
                    <div><Text strong>{formatCost(preview?.totalCost)}</Text></div>
                  </div>
                  <div>
                    <Text type="secondary">Cost / đơn vị thành phẩm</Text>
                    <div>
                      <Text strong>{formatCost(preview?.unitCost)}</Text>
                      {outputUnitId && (
                        <Text type="secondary">
                          {" / "}
                          {units.find((unit) => unit.id === outputUnitId)?.name ?? ""}
                        </Text>
                      )}
                    </div>
                  </div>
                  {editing?.recipe?.reference_unit_cost !== null &&
                    editing?.recipe?.reference_unit_cost !== undefined && (
                      <div>
                        <Text type="secondary">Mốc Cost hiện tại</Text>
                        <div>
                          <Text strong>
                            {formatCost(editing.recipe.reference_unit_cost)}
                          </Text>
                        </div>
                      </div>
                    )}
                </div>

                {preview && !preview.complete && (
                  <Alert
                    type="warning"
                    showIcon
                    message="Chưa thể tính đủ Cost"
                    description="Có nguyên liệu chưa có giá nhập hoặc sản lượng thành phẩm chưa hợp lệ."
                  />
                )}

                <div className="cost-reference-note">
                  <Text type="secondary">
                    Khi tạo hoặc thay đổi định lượng công thức, Cost hiện tại sẽ được
                    chốt làm mốc mới. Sau đó hệ thống chỉ cảnh báo khi giá nguyên liệu
                    làm Cost tăng vượt ngưỡng.
                  </Text>
                </div>
              </>
            )}
          </Card>
        </Form>
      </Modal>
    </>
  );
}
