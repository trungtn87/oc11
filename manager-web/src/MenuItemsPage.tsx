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
  acceptMenuOptionCurrentCost,
  createMenuItem,
  getCostIngredientPrices,
  getInventoryItems,
  getMenuCostAlerts,
  getMenuGroups,
  getMenuItems,
  getServiceOptionCosts,
  getUnits,
  updateMenuItem
} from "./api";
import type {
  CostIngredientPrice,
  InventoryItem,
  MenuCostAlert,
  MenuGroup,
  MenuItem,
  MenuItemInput,
  ServiceOptionCost,
  Unit
} from "./types";

const { Title, Text } = Typography;
const { TextArea } = Input;

type MenuItemForm = {
  name: string;
  menu_group_id: number;
  sale_unit_id: number;
  base_price: number;
  display_order: number;
  is_active: boolean;
  note?: string;
};

type ComponentDraft = {
  key: string;
  component_type: "ITEM" | "RECIPE";
  item_id?: number;
  unit_id?: number;
  recipe_id?: number;
  quantity?: number;
};

type OptionDraft = {
  key: string;
  id?: number;
  service_option_id?: number;
  extra_price: number;
  alert_threshold_percent: number;
  display_order: number;
  is_active: boolean;
  components: ComponentDraft[];
};

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value) + " đ";
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value) + "%";
}

function formatDateTime(value: string) {
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

export default function MenuItemsPage() {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [serviceOptions, setServiceOptions] = useState<ServiceOptionCost[]>([]);
  const [ingredientPrices, setIngredientPrices] = useState<CostIngredientPrice[]>([]);
  const [alerts, setAlerts] = useState<MenuCostAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acceptingOptionId, setAcceptingOptionId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [componentModalOpen, setComponentModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [editingOptionKey, setEditingOptionKey] = useState<string | null>(null);
  const [optionDrafts, setOptionDrafts] = useState<OptionDraft[]>([]);
  const [form] = Form.useForm<MenuItemForm>();
  const [messageApi, messageContext] = message.useMessage();

  const basePrice = Form.useWatch("base_price", form) ?? 0;

  const itemMap = useMemo(
    () => new Map(inventoryItems.map((row) => [row.id, row])),
    [inventoryItems]
  );
  const priceMap = useMemo(
    () => new Map(ingredientPrices.map((row) => [row.item_id, row])),
    [ingredientPrices]
  );
  const serviceOptionMap = useMemo(
    () => new Map(serviceOptions.map((row) => [row.id, row])),
    [serviceOptions]
  );

  const loadData = async () => {
    try {
      setLoading(true);
      const result = await Promise.all([
        getMenuItems(),
        getMenuGroups(),
        getUnits(),
        getInventoryItems(),
        getServiceOptionCosts(),
        getCostIngredientPrices(),
        getMenuCostAlerts()
      ]);
      setMenuItems(result[0]);
      setGroups(result[1]);
      setUnits(result[2]);
      setInventoryItems(result[3]);
      setServiceOptions(result[4]);
      setIngredientPrices(result[5]);
      setAlerts(result[6]);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được thực đơn."
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
    if (!keyword) return menuItems;
    return menuItems.filter(
      (row) =>
        row.name.toLocaleLowerCase("vi").includes(keyword) ||
        row.menu_group_name.toLocaleLowerCase("vi").includes(keyword)
    );
  }, [menuItems, search]);

  const currentOptionDraft = optionDrafts.find(
    (row) => row.key === editingOptionKey
  );

  const componentCost = (component: ComponentDraft) => {
    const quantity = Number(component.quantity || 0);
    if (quantity <= 0) {
      return { unitCost: null as number | null, lineCost: null as number | null, unitName: "" };
    }

    if (component.component_type === "ITEM") {
      if (!component.item_id || !component.unit_id) {
        return { unitCost: null, lineCost: null, unitName: "" };
      }
      const item = itemMap.get(component.item_id);
      const conversion = item?.conversions.find(
        (row) => row.unit_id === component.unit_id
      );
      const price = priceMap.get(component.item_id)?.current_price_per_smallest_unit;
      if (!item || !conversion || price === null || price === undefined) {
        return {
          unitCost: null,
          lineCost: null,
          unitName: conversion?.unit_name ?? ""
        };
      }
      const unitCost = price * conversion.quantity_in_smallest_unit;
      return {
        unitCost,
        lineCost: unitCost * quantity,
        unitName: conversion.unit_name
      };
    }

    if (!component.recipe_id) {
      return { unitCost: null, lineCost: null, unitName: "" };
    }
    const source = serviceOptions.find(
      (row) => row.recipe?.id === component.recipe_id
    );
    const recipe = source?.recipe;
    if (!recipe || !recipe.cost_complete || recipe.current_unit_cost === null) {
      return {
        unitCost: null,
        lineCost: null,
        unitName: recipe?.output_unit_name ?? ""
      };
    }
    return {
      unitCost: recipe.current_unit_cost,
      lineCost: recipe.current_unit_cost * quantity,
      unitName: recipe.output_unit_name
    };
  };

  const optionCost = (option: OptionDraft) => {
    if (option.components.length === 0) {
      return { complete: false, cost: null as number | null };
    }
    let cost = 0;
    for (const component of option.components) {
      const calc = componentCost(component);
      if (calc.lineCost === null) return { complete: false, cost: null };
      cost += calc.lineCost;
    }
    return { complete: true, cost };
  };

  const openCreate = () => {
    setEditingItem(null);
    setOptionDrafts([]);
    form.resetFields();
    form.setFieldsValue({
      base_price: 0,
      display_order: menuItems.length + 1,
      is_active: true
    });
    setModalOpen(true);
  };

  const openEdit = (row: MenuItem) => {
    setEditingItem(row);
    form.setFieldsValue({
      name: row.name,
      menu_group_id: row.menu_group_id,
      sale_unit_id: row.sale_unit_id,
      base_price: row.base_price,
      display_order: row.display_order,
      is_active: row.is_active,
      note: row.note ?? undefined
    });
    setOptionDrafts(
      row.options.map((option) => ({
        key: String(option.id),
        id: option.id,
        service_option_id: option.service_option_id,
        extra_price: option.extra_price,
        alert_threshold_percent: option.alert_threshold_percent,
        display_order: option.display_order,
        is_active: option.is_active,
        components: option.components.map((component) => ({
          key: String(component.id),
          component_type: component.component_type,
          item_id: component.item_id ?? undefined,
          unit_id: component.unit_id ?? undefined,
          recipe_id: component.recipe_id ?? undefined,
          quantity: component.quantity
        }))
      }))
    );
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setComponentModalOpen(false);
    setEditingOptionKey(null);
    setEditingItem(null);
    setOptionDrafts([]);
    form.resetFields();
  };

  const addOption = () => {
    setOptionDrafts((current) => [
      ...current,
      {
        key: "option-" + Date.now() + "-" + current.length,
        extra_price: 0,
        alert_threshold_percent: 5,
        display_order: current.length + 1,
        is_active: true,
        components: []
      }
    ]);
  };

  const updateOption = (key: string, patch: Partial<OptionDraft>) => {
    setOptionDrafts((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  };

  const removeOption = (key: string) => {
    setOptionDrafts((current) => current.filter((row) => row.key !== key));
  };

  const openComponents = (key: string) => {
    setEditingOptionKey(key);
    setComponentModalOpen(true);
  };

  const addComponent = () => {
    if (!editingOptionKey) return;
    setOptionDrafts((current) =>
      current.map((option) =>
        option.key === editingOptionKey
          ? {
              ...option,
              components: [
                ...option.components,
                {
                  key: "component-" + Date.now() + "-" + option.components.length,
                  component_type: "ITEM"
                }
              ]
            }
          : option
      )
    );
  };

  const updateComponent = (key: string, patch: Partial<ComponentDraft>) => {
    if (!editingOptionKey) return;
    setOptionDrafts((current) =>
      current.map((option) =>
        option.key === editingOptionKey
          ? {
              ...option,
              components: option.components.map((component) =>
                component.key === key ? { ...component, ...patch } : component
              )
            }
          : option
      )
    );
  };

  const removeComponent = (key: string) => {
    if (!editingOptionKey) return;
    setOptionDrafts((current) =>
      current.map((option) =>
        option.key === editingOptionKey
          ? {
              ...option,
              components: option.components.filter(
                (component) => component.key !== key
              )
            }
          : option
      )
    );
  };

  const validateOptions = () => {
    const selected = new Set<number>();
    for (const option of optionDrafts) {
      if (!option.service_option_id) {
        messageApi.error("Chọn kiểu chế biến cho tất cả các dòng.");
        return false;
      }
      if (selected.has(option.service_option_id)) {
        messageApi.error("Một kiểu chế biến chỉ được gán một lần cho món.");
        return false;
      }
      selected.add(option.service_option_id);

      if (option.components.length === 0) {
        const name = serviceOptionMap.get(option.service_option_id)?.name ?? "kiểu chế biến";
        messageApi.error("Chưa có định lượng cho " + name + ".");
        return false;
      }

      for (const component of option.components) {
        if (!component.quantity || component.quantity <= 0) {
          messageApi.error("Định lượng cần nhập số lượng lớn hơn 0.");
          return false;
        }
        if (
          component.component_type === "ITEM" &&
          (!component.item_id || !component.unit_id)
        ) {
          messageApi.error("Chọn đủ nguyên liệu và đơn vị trong định lượng.");
          return false;
        }
        if (
          component.component_type === "RECIPE" &&
          !component.recipe_id
        ) {
          messageApi.error("Chọn bán thành phẩm trong định lượng.");
          return false;
        }
      }
    }
    return true;
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      if (!validateOptions()) return;

      const payload: MenuItemInput = {
        name: values.name.trim(),
        menu_group_id: values.menu_group_id,
        sale_unit_id: values.sale_unit_id,
        base_price: Number(values.base_price ?? 0),
        display_order: Number(values.display_order ?? 0),
        is_active: values.is_active,
        note: values.note?.trim() || null,
        options: optionDrafts.map((option) => ({
          service_option_id: Number(option.service_option_id),
          extra_price: Number(option.extra_price ?? 0),
          alert_threshold_percent: Number(option.alert_threshold_percent ?? 5),
          display_order: Number(option.display_order ?? 0),
          is_active: option.is_active,
          components: option.components.map((component) => ({
            component_type: component.component_type,
            item_id:
              component.component_type === "ITEM" ? Number(component.item_id) : null,
            unit_id:
              component.component_type === "ITEM" ? Number(component.unit_id) : null,
            recipe_id:
              component.component_type === "RECIPE" ? Number(component.recipe_id) : null,
            quantity: Number(component.quantity)
          }))
        }))
      };

      setSaving(true);
      if (editingItem) {
        await updateMenuItem(editingItem.id, payload);
        messageApi.success("Đã cập nhật món và định lượng.");
      } else {
        await createMenuItem(payload);
        messageApi.success("Đã thêm món thực đơn.");
      }
      closeModal();
      await loadData();
    } catch (error) {
      if (error instanceof Error) messageApi.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const acceptCurrentCost = async (optionId: number) => {
    try {
      setAcceptingOptionId(optionId);
      await acceptMenuOptionCurrentCost(optionId);
      messageApi.success("Đã dùng Cost món hiện tại làm mốc mới.");
      await loadData();
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không cập nhật được mốc Cost."
      );
    } finally {
      setAcceptingOptionId(null);
    }
  };

  const itemColumns: TableProps<MenuItem>["columns"] = [
    {
      title: "Món",
      dataIndex: "name",
      key: "name",
      render: (value: string) => <Text strong>{value}</Text>
    },
    {
      title: "Nhóm",
      dataIndex: "menu_group_name",
      key: "menu_group_name",
      width: 170
    },
    {
      title: "Giá cơ bản",
      dataIndex: "base_price",
      key: "base_price",
      width: 140,
      render: formatMoney
    },
    {
      title: "Kiểu chế biến",
      key: "options",
      width: 130,
      render: (_, row) => row.options.length
    },
    {
      title: "Cost",
      key: "cost",
      width: 200,
      render: (_, row) => {
        const complete = row.options
          .filter((option) => option.current_cost !== null)
          .map((option) => option.current_cost as number);
        if (complete.length === 0) return <Text type="secondary">—</Text>;
        const min = Math.min(...complete);
        const max = Math.max(...complete);
        return min === max ? formatMoney(min) : formatMoney(min) + " – " + formatMoney(max);
      }
    },
    {
      title: "Cảnh báo",
      key: "alerts",
      width: 120,
      render: (_, row) => {
        const count = row.options.filter((option) => option.has_open_alert).length;
        return count > 0 ? (
          <Tag color="error">{count} cảnh báo</Tag>
        ) : (
          <Tag color="success">Bình thường</Tag>
        );
      }
    },
    {
      title: "Trạng thái",
      dataIndex: "is_active",
      key: "is_active",
      width: 140,
      render: (value: boolean) =>
        value ? <Tag color="success">Đang bán</Tag> : <Tag>Ngừng bán</Tag>
    },
    {
      title: "Thao tác",
      key: "action",
      width: 90,
      render: (_, row) => (
        <Button type="link" onClick={() => openEdit(row)}>
          Sửa
        </Button>
      )
    }
  ];

  const optionColumns: TableProps<OptionDraft>["columns"] = [
    {
      title: "Kiểu chế biến",
      key: "service_option",
      render: (_, option) => {
        const usedByOthers = new Set(
          optionDrafts
            .filter((row) => row.key !== option.key)
            .map((row) => row.service_option_id)
            .filter((value): value is number => Boolean(value))
        );
        return (
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: "100%" }}
            value={option.service_option_id}
            placeholder="Chọn kiểu chế biến"
            options={serviceOptions.map((row) => ({
              value: row.id,
              label: row.name,
              disabled: usedByOthers.has(row.id) || !row.is_active
            }))}
            onChange={(serviceOptionId) =>
              updateOption(option.key, { service_option_id: serviceOptionId })
            }
          />
        );
      }
    },
    {
      title: "Phụ thu",
      key: "extra_price",
      width: 125,
      render: (_, option) => (
        <InputNumber
          min={0}
          step={1000}
          value={option.extra_price}
          style={{ width: "100%" }}
          onChange={(value) =>
            updateOption(option.key, {
              extra_price: typeof value === "number" ? value : 0
            })
          }
        />
      )
    },
    {
      title: "Giá bán",
      key: "sale_price",
      width: 130,
      render: (_, option) =>
        formatMoney(Number(basePrice || 0) + Number(option.extra_price || 0))
    },
    {
      title: "Định lượng",
      key: "components",
      width: 155,
      render: (_, option) => (
        <Button onClick={() => openComponents(option.key)}>
          {option.components.length > 0
            ? option.components.length + " thành phần"
            : "Nhập định lượng"}
        </Button>
      )
    },
    {
      title: "Cost",
      key: "cost",
      width: 135,
      render: (_, option) => {
        const calc = optionCost(option);
        return calc.complete ? formatMoney(calc.cost) : <Tag color="warning">Chưa đủ</Tag>;
      }
    },
    {
      title: "Cost %",
      key: "cost_percent",
      width: 100,
      render: (_, option) => {
        const calc = optionCost(option);
        const salePrice = Number(basePrice || 0) + Number(option.extra_price || 0);
        if (!calc.complete || calc.cost === null || salePrice <= 0) return "—";
        return formatPercent((calc.cost / salePrice) * 100);
      }
    },
    {
      title: "Cảnh báo %",
      key: "threshold",
      width: 110,
      render: (_, option) => (
        <InputNumber
          min={0.01}
          max={100}
          value={option.alert_threshold_percent}
          style={{ width: "100%" }}
          onChange={(value) =>
            updateOption(option.key, {
              alert_threshold_percent: typeof value === "number" ? value : 5
            })
          }
        />
      )
    },
    {
      title: "",
      key: "remove",
      width: 60,
      render: (_, option) => (
        <Button danger type="text" onClick={() => removeOption(option.key)}>
          Xóa
        </Button>
      )
    }
  ];

  const componentColumns: TableProps<ComponentDraft>["columns"] = [
    {
      title: "Loại",
      key: "type",
      width: 150,
      render: (_, component) => (
        <Select
          value={component.component_type}
          style={{ width: "100%" }}
          options={[
            { value: "ITEM", label: "Nguyên liệu" },
            { value: "RECIPE", label: "Bán thành phẩm" }
          ]}
          onChange={(value: "ITEM" | "RECIPE") =>
            updateComponent(component.key, {
              component_type: value,
              item_id: undefined,
              unit_id: undefined,
              recipe_id: undefined,
              quantity: undefined
            })
          }
        />
      )
    },
    {
      title: "Thành phần",
      key: "component",
      render: (_, component) =>
        component.component_type === "ITEM" ? (
          <Select
            showSearch
            optionFilterProp="label"
            value={component.item_id}
            style={{ width: "100%" }}
            placeholder="Chọn hàng hóa"
            options={inventoryItems.map((item) => ({
              value: item.id,
              label: item.name,
              disabled: !item.is_active
            }))}
            onChange={(itemId) => {
              const item = itemMap.get(itemId);
              const preferred =
                item?.conversions.find((row) => row.unit_id === item.default_unit_id) ??
                item?.conversions[0];
              updateComponent(component.key, {
                item_id: itemId,
                unit_id: preferred?.unit_id,
                quantity: undefined
              });
            }}
          />
        ) : (
          <Select
            showSearch
            optionFilterProp="label"
            value={component.recipe_id}
            style={{ width: "100%" }}
            placeholder="Chọn sốt / bán thành phẩm"
            options={serviceOptions
              .filter((row) => row.recipe)
              .map((row) => ({
                value: row.recipe!.id,
                label: row.name,
                disabled: !row.is_active || !row.recipe!.is_active
              }))}
            onChange={(recipeId) =>
              updateComponent(component.key, {
                recipe_id: recipeId,
                quantity: undefined
              })
            }
          />
        )
    },
    {
      title: "Số lượng",
      key: "quantity",
      width: 120,
      render: (_, component) => (
        <InputNumber
          min={0.000001}
          step="any"
          value={component.quantity}
          style={{ width: "100%" }}
          onChange={(value) =>
            updateComponent(component.key, {
              quantity: typeof value === "number" ? value : undefined
            })
          }
        />
      )
    },
    {
      title: "ĐVT",
      key: "unit",
      width: 125,
      render: (_, component) => {
        if (component.component_type === "RECIPE") {
          const source = serviceOptions.find((row) => row.recipe?.id === component.recipe_id);
          return source?.recipe?.output_unit_name ?? "—";
        }
        const item = component.item_id ? itemMap.get(component.item_id) : undefined;
        return (
          <Select
            value={component.unit_id}
            style={{ width: "100%" }}
            disabled={!item}
            options={(item?.conversions ?? []).map((row) => ({
              value: row.unit_id,
              label: row.unit_name,
              disabled: !row.is_active
            }))}
            onChange={(unitId) => updateComponent(component.key, { unit_id: unitId })}
          />
        );
      }
    },
    {
      title: "Cost / ĐVT",
      key: "unit_cost",
      width: 140,
      render: (_, component) => {
        const calc = componentCost(component);
        return calc.unitCost === null ? <Tag color="warning">Thiếu giá</Tag> : formatMoney(calc.unitCost);
      }
    },
    {
      title: "Thành tiền",
      key: "line_cost",
      width: 140,
      render: (_, component) => {
        const calc = componentCost(component);
        return calc.lineCost === null ? "—" : formatMoney(calc.lineCost);
      }
    },
    {
      title: "",
      key: "remove",
      width: 60,
      render: (_, component) => (
        <Button danger type="text" onClick={() => removeComponent(component.key)}>
          Xóa
        </Button>
      )
    }
  ];

  const alertColumns: TableProps<MenuCostAlert>["columns"] = [
    {
      title: "Món",
      dataIndex: "menu_item_name",
      key: "menu_item_name",
      render: (value: string) => <Text strong>{value}</Text>
    },
    {
      title: "Kiểu chế biến",
      dataIndex: "service_option_name",
      key: "service_option_name"
    },
    {
      title: "Cost mốc",
      dataIndex: "reference_cost",
      key: "reference_cost",
      width: 145,
      render: formatMoney
    },
    {
      title: "Cost hiện tại",
      dataIndex: "current_cost",
      key: "current_cost",
      width: 145,
      render: (value: number) => <Text strong>{formatMoney(value)}</Text>
    },
    {
      title: "Tăng",
      dataIndex: "change_percent",
      key: "change_percent",
      width: 105,
      render: (value: number) => <Tag color="error">+{formatPercent(value)}</Tag>
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
          loading={acceptingOptionId === row.menu_item_option_id}
          onClick={() => void acceptCurrentCost(row.menu_item_option_id)}
        >
          Dùng Cost mới làm mốc
        </Button>
      )
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Món thực đơn & định lượng</Title>
          <Text type="secondary">
            Tầng 2: định lượng món dùng trực tiếp nguyên liệu và bán thành phẩm từ tầng 1.
          </Text>
        </div>
        <Button type="primary" size="large" onClick={openCreate}>
          + Thêm món
        </Button>
      </div>

      {alerts.length > 0 && (
        <Alert
          type="warning"
          showIcon
          className="cost-alert-banner"
          message={"Có " + alerts.length + " món/kiểu chế biến tăng Cost vượt ngưỡng"}
          description="Hệ thống chỉ cảnh báo. Giá bán và phụ thu không tự thay đổi."
        />
      )}

      <Tabs
        defaultActiveKey="items"
        items={[
          {
            key: "items",
            label: "Món thực đơn",
            children: (
              <>
                <div className="toolbar">
                  <Input.Search
                    allowClear
                    placeholder="Tìm món hoặc nhóm thực đơn..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="search-box"
                  />
                </div>
                <div className="table-card">
                  <Table<MenuItem>
                    rowKey="id"
                    loading={loading}
                    dataSource={filteredItems}
                    columns={itemColumns}
                    pagination={false}
                    locale={{ emptyText: "Chưa có món thực đơn." }}
                  />
                </div>
              </>
            )
          },
          {
            key: "alerts",
            label: alerts.length
              ? "Cảnh báo Cost món (" + alerts.length + ")"
              : "Cảnh báo Cost món",
            children: (
              <div className="table-card">
                <Table<MenuCostAlert>
                  rowKey="id"
                  loading={loading}
                  dataSource={alerts}
                  columns={alertColumns}
                  pagination={false}
                  locale={{ emptyText: "Không có cảnh báo Cost món đang mở." }}
                />
              </div>
            )
          }
        ]}
      />

      <Modal
        open={modalOpen}
        width={1120}
        title={editingItem ? "Sửa món thực đơn" : "Thêm món thực đơn"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        onCancel={closeModal}
        onOk={() => void save()}
      >
        <Form<MenuItemForm>
          form={form}
          layout="vertical"
          initialValues={{ base_price: 0, display_order: 0, is_active: true }}
        >
          <div className="menu-item-base-grid">
            <Form.Item
              label="Tên món"
              name="name"
              rules={[{ required: true, whitespace: true, message: "Nhập tên món." }]}
            >
              <Input autoFocus placeholder="Ví dụ: Ốc hương" />
            </Form.Item>

            <Form.Item
              label="Nhóm thực đơn"
              name="menu_group_id"
              rules={[{ required: true, message: "Chọn nhóm thực đơn." }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={groups.map((group) => ({
                  value: group.id,
                  label: group.name,
                  disabled: !group.is_active && editingItem?.menu_group_id !== group.id
                }))}
              />
            </Form.Item>

            <Form.Item
              label="Đơn vị bán"
              name="sale_unit_id"
              rules={[{ required: true, message: "Chọn đơn vị bán." }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={units.map((unit) => ({
                  value: unit.id,
                  label: unit.name,
                  disabled: !unit.is_active && editingItem?.sale_unit_id !== unit.id
                }))}
              />
            </Form.Item>

            <Form.Item
              label="Giá bán cơ bản"
              name="base_price"
              rules={[{ required: true, message: "Nhập giá bán cơ bản." }]}
            >
              <InputNumber min={0} step={1000} style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item label="Thứ tự" name="display_order">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
              <Switch checkedChildren="Đang bán" unCheckedChildren="Ngừng bán" />
            </Form.Item>
          </div>

          <Form.Item label="Ghi chú" name="note">
            <TextArea rows={2} placeholder="Không bắt buộc..." />
          </Form.Item>
        </Form>

        <Card
          size="small"
          className="menu-options-card"
          title="Kiểu chế biến & định lượng"
          extra={
            <Button icon={<PlusOutlined />} onClick={addOption}>
              Thêm kiểu chế biến
            </Button>
          }
        >
          <Table<OptionDraft>
            rowKey="key"
            dataSource={optionDrafts}
            columns={optionColumns}
            pagination={false}
            size="small"
            locale={{
              emptyText: "Chưa gán kiểu chế biến. Có thể lưu món trước rồi bổ sung sau."
            }}
          />
        </Card>

        <div className="cost-reference-note">
          <Text type="secondary">
            Khi tạo mới hoặc thay đổi định lượng, Cost hiện tại được chốt làm mốc.
            Giá nguyên liệu/sốt tăng đủ ngưỡng sẽ cảnh báo, không thay giá bán.
          </Text>
        </div>
      </Modal>

      <Modal
        open={componentModalOpen}
        width={980}
        title={
          currentOptionDraft?.service_option_id
            ? "Định lượng — " +
              (serviceOptionMap.get(currentOptionDraft.service_option_id)?.name ?? "")
            : "Định lượng món"
        }
        footer={
          <Button
            type="primary"
            onClick={() => {
              setComponentModalOpen(false);
              setEditingOptionKey(null);
            }}
          >
            Xong
          </Button>
        }
        onCancel={() => {
          setComponentModalOpen(false);
          setEditingOptionKey(null);
        }}
      >
        <div className="menu-component-heading">
          <div>
            <Text strong>Thành phần của món sau khi chọn kiểu chế biến</Text>
            <div>
              <Text type="secondary">
                Dùng hàng hóa trực tiếp và sốt/bán thành phẩm đã tính ở tầng 1.
              </Text>
            </div>
          </div>
          <Button icon={<PlusOutlined />} onClick={addComponent}>
            Thêm thành phần
          </Button>
        </div>

        <Table<ComponentDraft>
          rowKey="key"
          dataSource={currentOptionDraft?.components ?? []}
          columns={componentColumns}
          pagination={false}
          size="small"
          locale={{ emptyText: "Chưa có thành phần định lượng." }}
        />

        {currentOptionDraft && (
          <div className="menu-component-total">
            <Text type="secondary">Cost món hiện tại</Text>
            <Title level={4} style={{ margin: 0 }}>
              {optionCost(currentOptionDraft).complete
                ? formatMoney(optionCost(currentOptionDraft).cost)
                : "Chưa đủ dữ liệu"}
            </Title>
          </div>
        )}
      </Modal>
    </>
  );
}
