import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from "antd";
import type { TableProps } from "antd";

import {
  createInventoryItem,
  createPurchaseReceipt,
  createSupplier,
  getFundAccounts,
  getInventoryItems,
  getItemGroups,
  getPurchaseReceipt,
  getPurchaseReceipts,
  getSuppliers,
  getUnits,
  updateInventoryItem,
  updatePurchaseReceipt,
  voidPurchaseReceiptForReentry
} from "./api";
import type {
  FundAccount,
  FundAccountType,
  InventoryItem,
  ItemGroup,
  PurchasePaymentStatus,
  PurchaseReceipt,
  PurchaseReceiptInput,
  Supplier,
  Unit,
  VoucherPrefill
} from "./types";

const { Title, Text } = Typography;

type PurchaseOrdersPageProps = {
  onPayDebt: (prefill: VoucherPrefill) => void;
  initialReceiptId?: number | null;
  onInitialReceiptConsumed?: () => void;
};

type ReceiptLineDraft = {
  key: string;
  item_id?: number;
  unit_id?: number;
  quantity?: number;
  unit_price?: number;
  note?: string;
};

type ReceiptForm = {
  supplier_id: number;
  receipt_time: string;
  description?: string;
  shipping_fee?: number;
  payment_status: PurchasePaymentStatus;
  account_type?: FundAccountType;
  fund_account_id?: number;
};

type QuickSupplierForm = {
  name: string;
};

type QuickItemForm = {
  name: string;
  item_group_id: number;
  unit_id: number;
};

type QuickConversionForm = {
  unit_id: number;
  quantity_in_smallest_unit: number;
};

function money(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function toLocalDateTimeInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(parsed);
}

function newLine(): ReceiptLineDraft {
  return {
    key: `line-${Date.now()}-${Math.random().toString(16).slice(2)}`
  };
}

export default function PurchaseOrdersPage({
  onPayDebt,
  initialReceiptId,
  onInitialReceiptConsumed
}: PurchaseOrdersPageProps) {
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemGroups, setItemGroups] = useState<ItemGroup[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<PurchasePaymentStatus | "all">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<PurchaseReceipt | null>(null);
  const [replacingReceiptId, setReplacingReceiptId] = useState<number | null>(null);
  const [lines, setLines] = useState<ReceiptLineDraft[]>([newLine()]);
  const [quickSupplierOpen, setQuickSupplierOpen] = useState(false);
  const [quickItemOpen, setQuickItemOpen] = useState(false);
  const [quickItemLineKey, setQuickItemLineKey] = useState<string | null>(null);
  const [quickConversionOpen, setQuickConversionOpen] = useState(false);
  const [conversionLineKey, setConversionLineKey] = useState<string | null>(null);
  const [conversionItem, setConversionItem] = useState<InventoryItem | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);
  const [viewReceipt, setViewReceipt] = useState<PurchaseReceipt | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [form] = Form.useForm<ReceiptForm>();
  const [quickSupplierForm] = Form.useForm<QuickSupplierForm>();
  const [quickItemForm] = Form.useForm<QuickItemForm>();
  const [quickConversionForm] = Form.useForm<QuickConversionForm>();
  const paymentStatus = Form.useWatch("payment_status", form);
  const accountType = Form.useWatch("account_type", form);
  const [messageApi, messageContext] = message.useMessage();

  const activeSuppliers = suppliers;
  const activeItems = items.filter((item) => item.is_active);
  const activeUnits = units.filter((unit) => unit.is_active);
  const paymentAccounts = accounts.filter(
    (account) => account.is_active && account.type === accountType
  );

  const loadMasterData = async () => {
    const [nextSuppliers, nextItems, nextGroups, nextUnits, nextAccounts] = await Promise.all([
      getSuppliers(),
      getInventoryItems(),
      getItemGroups(),
      getUnits(),
      getFundAccounts()
    ]);
    setSuppliers(nextSuppliers);
    setItems(nextItems);
    setItemGroups(nextGroups);
    setUnits(nextUnits);
    setAccounts(nextAccounts);
  };

  const loadReceipts = async () => {
    try {
      setLoading(true);
      setReceipts(
        await getPurchaseReceipts({
          supplier_id: supplierFilter === "all" ? undefined : supplierFilter,
          payment_status: statusFilter === "all" ? undefined : statusFilter,
          search: search || undefined
        })
      );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không tải được phiếu nhập.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        await loadMasterData();
        await loadReceipts();
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : "Không tải được dữ liệu nhập hàng.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!initialReceiptId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        setViewLoading(true);
        const detail = await getPurchaseReceipt(initialReceiptId);
        if (!cancelled) {
          setViewReceipt(detail);
        }
      } catch (error) {
        if (!cancelled) {
          messageApi.error(
            error instanceof Error ? error.message : "Không mở được chứng từ liên quan."
          );
        }
      } finally {
        if (!cancelled) {
          setViewLoading(false);
          onInitialReceiptConsumed?.();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialReceiptId]);

  const goodsTotal = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + (line.quantity ?? 0) * (line.unit_price ?? 0),
        0
      ),
    [lines]
  );
  const shippingFee = Form.useWatch("shipping_fee", form) ?? 0;
  const totalAmount = goodsTotal + shippingFee;

  const updateLine = (key: string, patch: Partial<ReceiptLineDraft>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  };

  const chooseItem = (key: string, itemId: number) => {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    updateLine(key, {
      item_id: itemId,
      unit_id: item.default_unit_id
    });
  };

  const openCreate = () => {
    setEditingReceipt(null);
    setReplacingReceiptId(null);
    form.resetFields();

    const firstCashAccount =
      accounts.find(
        (account) =>
          account.is_active &&
          account.type === "CASH" &&
          account.is_default
      ) ??
      accounts.find(
        (account) => account.is_active && account.type === "CASH"
      );

    form.setFieldsValue({
      receipt_time: toLocalDateTimeInput(new Date()),
      shipping_fee: 0,
      payment_status: "PAID",
      account_type: "CASH",
      fund_account_id: firstCashAccount?.id
    });
    setLines([newLine()]);
    setModalOpen(true);
  };

  const closeCreate = () => {
    setModalOpen(false);
    setEditingReceipt(null);
    setReplacingReceiptId(null);
    setLines([newLine()]);
    form.resetFields();
  };

  const receiptToLines = (receipt: PurchaseReceipt): ReceiptLineDraft[] =>
    receipt.items.map((item) => ({
      key: `receipt-${receipt.id}-line-${item.id}`,
      item_id: item.item_id,
      unit_id: item.unit_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      note: item.note ?? undefined
    }));

  const fillReceiptForm = (
    receipt: PurchaseReceipt,
    mode: "edit" | "replace"
  ) => {
    setEditingReceipt(mode === "edit" ? receipt : null);
    setReplacingReceiptId(mode === "replace" ? receipt.id : null);
    form.resetFields();
    form.setFieldsValue({
      supplier_id: receipt.supplier_id,
      receipt_time: receipt.receipt_time.slice(0, 16),
      description: receipt.description ?? undefined,
      shipping_fee: receipt.shipping_fee,
      payment_status: mode === "edit" ? "DEBT" : receipt.payment_status,
      account_type:
        mode === "replace"
          ? (receipt.payment_account_type ?? undefined)
          : undefined,
      fund_account_id:
        mode === "replace"
          ? (receipt.payment_fund_account_id ?? undefined)
          : undefined
    });
    setLines(receiptToLines(receipt));
    setModalOpen(true);
  };

  const openEditReceipt = async (receipt: PurchaseReceipt) => {
    try {
      const detail = await getPurchaseReceipt(receipt.id);
      if (detail.is_void) {
        messageApi.warning("Phiếu đã hủy không thể sửa.");
        return;
      }
      if (detail.payment_status !== "DEBT") {
        messageApi.warning("Phiếu đã thanh toán không được sửa. Hãy dùng Hủy để nhập lại.");
        return;
      }
      fillReceiptForm(detail, "edit");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không mở được phiếu nhập.");
    }
  };

  const openReentryReceipt = async (receipt: PurchaseReceipt) => {
    try {
      const detail = receipt.items.length
        ? receipt
        : await getPurchaseReceipt(receipt.id);
      if (!detail.is_void) {
        messageApi.warning("Chỉ nhập lại từ phiếu đã hủy.");
        return;
      }
      if (detail.replacement_receipt_id) {
        messageApi.info(`Phiếu đã được thay thế bởi ${detail.replacement_receipt_code}.`);
        return;
      }
      fillReceiptForm(detail, "replace");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không mở được phiếu nhập.");
    }
  };

  const voidAndReenter = (receipt: PurchaseReceipt) => {
    Modal.confirm({
      title: `Hủy ${receipt.receipt_code} để nhập lại?`,
      content:
        "Hệ thống sẽ đảo toàn bộ hàng đã nhập, hoàn tác phiếu chi và hoàn lại số dư quỹ/tài khoản. Phiếu cũ vẫn được giữ với trạng thái Đã hủy.",
      okText: "Hủy và nhập lại",
      cancelText: "Không",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const voided = await voidPurchaseReceiptForReentry(receipt.id);
          setViewReceipt(null);
          await Promise.all([loadReceipts(), loadMasterData()]);
          fillReceiptForm(voided, "replace");
          messageApi.success(`Đã hủy ${receipt.receipt_code}. Hãy kiểm tra và lưu phiếu mới.`);
        } catch (error) {
          messageApi.error(
            error instanceof Error ? error.message : "Không hủy được phiếu nhập."
          );
          throw error;
        }
      }
    });
  };

  const saveReceipt = async () => {
    try {
      const values = await form.validateFields();
      const invalid = lines.find(
        (line) =>
          !line.item_id ||
          !line.unit_id ||
          !line.quantity ||
          line.quantity <= 0 ||
          line.unit_price === undefined ||
          line.unit_price < 0
      );
      if (invalid) {
        messageApi.error("Điền đủ hàng hóa, đơn vị, số lượng và đơn giá.");
        return;
      }

      const payload: PurchaseReceiptInput = {
        supplier_id: values.supplier_id,
        receipt_time: values.receipt_time,
        description: values.description?.trim() || null,
        shipping_fee: values.shipping_fee ?? 0,
        payment_status: values.payment_status,
        payment:
          values.payment_status === "PAID"
            ? {
                account_type: values.account_type as FundAccountType,
                fund_account_id: values.fund_account_id as number
              }
            : null,
        replaces_receipt_id: replacingReceiptId,
        items: lines.map((line) => ({
          item_id: line.item_id as number,
          unit_id: line.unit_id as number,
          quantity: line.quantity as number,
          unit_price: line.unit_price as number,
          note: line.note?.trim() || null
        }))
      };

      setSaving(true);
      if (editingReceipt) {
        await updatePurchaseReceipt(editingReceipt.id, {
          ...payload,
          payment_status: "DEBT",
          payment: null,
          replaces_receipt_id: editingReceipt.replaces_receipt_id
        });
        messageApi.success("Đã cập nhật phiếu trả nợ và đồng bộ lại tồn kho.");
      } else {
        const created = await createPurchaseReceipt(payload);
        messageApi.success(
          replacingReceiptId
            ? `Đã tạo ${created.receipt_code} thay thế phiếu đã hủy.`
            : "Đã lưu phiếu nhập và cập nhật tồn kho."
        );
      }
      closeCreate();
      await Promise.all([loadReceipts(), loadMasterData()]);
    } catch (error) {
      if (error instanceof Error) messageApi.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const openQuickItem = (lineKey: string) => {
    const firstGroup = itemGroups.find((group) => group.is_active);
    const firstUnit = units.find((unit) => unit.is_active);

    setQuickItemLineKey(lineKey);
    quickItemForm.resetFields();
    quickItemForm.setFieldsValue({
      item_group_id: firstGroup?.id,
      unit_id: firstUnit?.id
    });
    setQuickItemOpen(true);
  };

  const saveQuickItem = async () => {
    if (!quickItemLineKey) return;

    try {
      const values = await quickItemForm.validateFields();
      setQuickSaving(true);

      const created = await createInventoryItem({
        name: values.name.trim(),
        item_group_id: values.item_group_id,
        default_unit_id: values.unit_id,
        smallest_unit_id: values.unit_id,
        note: null,
        is_active: true,
        conversions: []
      });

      const nextItems = await getInventoryItems();
      setItems(nextItems);
      updateLine(quickItemLineKey, {
        item_id: created.id,
        unit_id: created.default_unit_id
      });
      setQuickItemOpen(false);
      setQuickItemLineKey(null);
      quickItemForm.resetFields();
      messageApi.success("Đã thêm hàng hóa và chọn vào phiếu nhập.");
    } catch (error) {
      if (error instanceof Error) messageApi.error(error.message);
    } finally {
      setQuickSaving(false);
    }
  };

  const saveQuickSupplier = async () => {
    try {
      const values = await quickSupplierForm.validateFields();
      setQuickSaving(true);
      const created = await createSupplier({
        name: values.name.trim(),
        phone: null,
        address: null,
        note: null,
        bank_name: null,
        bank_account_number: null,
        bank_account_name: null,
        payment_qr_image: null
      });
      setSuppliers(await getSuppliers());
      form.setFieldValue("supplier_id", created.id);
      setQuickSupplierOpen(false);
      quickSupplierForm.resetFields();
      messageApi.success("Đã thêm nhà cung cấp.");
    } catch (error) {
      if (error instanceof Error) messageApi.error(error.message);
    } finally {
      setQuickSaving(false);
    }
  };

  const openQuickConversion = (line: ReceiptLineDraft) => {
    if (!line.item_id) {
      messageApi.info("Chọn hàng hóa trước khi thêm quy đổi.");
      return;
    }
    const item = items.find((candidate) => candidate.id === line.item_id);
    if (!item) return;
    setConversionLineKey(line.key);
    setConversionItem(item);
    quickConversionForm.resetFields();
    setQuickConversionOpen(true);
  };

  const saveQuickConversion = async () => {
    if (!conversionItem || !conversionLineKey) return;
    try {
      const values = await quickConversionForm.validateFields();
      if (conversionItem.conversions.some((row) => row.unit_id === values.unit_id)) {
        messageApi.warning("Đơn vị này đã có quy đổi.");
        return;
      }
      setQuickSaving(true);
      await updateInventoryItem(conversionItem.id, {
        name: conversionItem.name,
        item_group_id: conversionItem.item_group_id,
        default_unit_id: conversionItem.default_unit_id,
        smallest_unit_id: conversionItem.smallest_unit_id,
        note: conversionItem.note,
        is_active: conversionItem.is_active,
        conversions: [
          ...conversionItem.conversions.map((row) => ({
            unit_id: row.unit_id,
            quantity_in_smallest_unit: row.quantity_in_smallest_unit,
            is_active: row.is_active
          })),
          {
            unit_id: values.unit_id,
            quantity_in_smallest_unit: values.quantity_in_smallest_unit,
            is_active: true
          }
        ]
      });
      const nextItems = await getInventoryItems();
      setItems(nextItems);
      updateLine(conversionLineKey, { unit_id: values.unit_id });
      setQuickConversionOpen(false);
      setConversionItem(null);
      setConversionLineKey(null);
      messageApi.success("Đã thêm quy đổi và chọn đơn vị mới.");
    } catch (error) {
      if (error instanceof Error) messageApi.error(error.message);
    } finally {
      setQuickSaving(false);
    }
  };

  const showReceipt = async (receipt: PurchaseReceipt) => {
    try {
      setViewLoading(true);
      setViewReceipt(await getPurchaseReceipt(receipt.id));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không mở được phiếu nhập.");
    } finally {
      setViewLoading(false);
    }
  };

  const payDebt = (receipt: PurchaseReceipt) => {
    onPayDebt({
      direction: "OUT",
      amount: receipt.total_amount,
      category_name: "Thanh toán nhà cung cấp",
      description: `Thanh toán phiếu nhập ${receipt.receipt_code} - ${receipt.supplier_name}`,
      note: `Phiếu nhập ${receipt.receipt_code}`,
      source_type: "PURCHASE_RECEIPT",
      source_id: String(receipt.id)
    });
  };

  const columns: TableProps<PurchaseReceipt>["columns"] = [
    {
      title: "Ngày nhập",
      dataIndex: "receipt_time",
      key: "receipt_time",
      width: 145,
      render: (value: string) => formatDateTime(value)
    },
    {
      title: "Số phiếu",
      dataIndex: "receipt_code",
      key: "receipt_code",
      width: 120,
      render: (value: string, row) => (
        <Button type="link" className="purchase-code-link" onClick={() => void showReceipt(row)}>
          {value}
        </Button>
      )
    },
    {
      title: "Nhà cung cấp",
      dataIndex: "supplier_name",
      key: "supplier_name"
    },
    {
      title: "Tiền hàng",
      dataIndex: "goods_total",
      key: "goods_total",
      width: 140,
      align: "right",
      render: (value: number) => money(value)
    },
    {
      title: "Phí vận chuyển",
      dataIndex: "shipping_fee",
      key: "shipping_fee",
      width: 135,
      align: "right",
      render: (value: number) => (value ? money(value) : "")
    },
    {
      title: "Tổng tiền",
      dataIndex: "total_amount",
      key: "total_amount",
      width: 145,
      align: "right",
      render: (value: number) => <Text strong>{money(value)}</Text>
    },
    {
      title: "Trạng thái",
      dataIndex: "payment_status",
      key: "payment_status",
      width: 140,
      render: (value: PurchasePaymentStatus, row) =>
        row.is_void ? (
          <Tag>Đã hủy</Tag>
        ) : value === "PAID" ? (
          <Tag color="success">Đã thanh toán</Tag>
        ) : (
          <Tag color="gold">Trả nợ</Tag>
        )
    },
    {
      title: "Thao tác",
      key: "actions",
      width: 125,
      render: (_, row) => {
        if (row.is_void) {
          return row.replacement_receipt_code ? (
            <Text type="secondary">→ {row.replacement_receipt_code}</Text>
          ) : (
            <Button type="link" onClick={() => void openReentryReceipt(row)}>
              Nhập lại
            </Button>
          );
        }

        if (row.payment_status === "DEBT") {
          return (
            <Space size={2}>
              <Button type="link" onClick={() => void openEditReceipt(row)}>
                Sửa
              </Button>
              <Button type="link" onClick={() => payDebt(row)}>
                Trả nợ
              </Button>
            </Space>
          );
        }

        return (
          <Button danger type="link" onClick={() => voidAndReenter(row)}>
            Hủy để nhập lại
          </Button>
        );
      }
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Nhập hàng</Title>
          <Text type="secondary">
            Lập phiếu sau khi hàng đã về quán. Lưu phiếu sẽ cập nhật tồn kho ngay.
          </Text>
        </div>
        <Button type="primary" size="large" onClick={openCreate}>
          + Thêm phiếu nhập
        </Button>
      </div>

      <div className="toolbar purchase-toolbar">
        <Input.Search
          allowClear
          placeholder="Tìm số phiếu, nhà cung cấp, diễn giải..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onSearch={() => void loadReceipts()}
          className="search-box"
        />
        <Select<number | "all">
          value={supplierFilter}
          onChange={(value) => setSupplierFilter(value)}
          style={{ minWidth: 210 }}
          options={[
            { value: "all", label: "Tất cả nhà cung cấp" },
            ...activeSuppliers.map((supplier) => ({
              value: supplier.id,
              label: supplier.name
            }))
          ]}
        />
        <Select<PurchasePaymentStatus | "all">
          value={statusFilter}
          onChange={(value) => setStatusFilter(value)}
          style={{ width: 170 }}
          options={[
            { value: "all", label: "Tất cả trạng thái" },
            { value: "PAID", label: "Đã thanh toán" },
            { value: "DEBT", label: "Trả nợ" }
          ]}
        />
        <Button type="primary" onClick={() => void loadReceipts()}>
          Lấy dữ liệu
        </Button>
      </div>

      <div className="table-card">
        <Table<PurchaseReceipt>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={receipts}
          pagination={{ pageSize: 30, showSizeChanger: false }}
          scroll={{ x: 1100 }}
          locale={{ emptyText: "Chưa có phiếu nhập." }}
          rowClassName={(row) => (row.is_void ? "purchase-row-void" : "")}
        />
      </div>

      <Modal
        open={modalOpen}
        width="min(1180px, 96vw)"
        title={
          editingReceipt
            ? `Sửa phiếu ${editingReceipt.receipt_code}`
            : replacingReceiptId
              ? "Nhập lại phiếu đã hủy"
              : "Thêm phiếu nhập hàng"
        }
        okText={editingReceipt ? "Lưu thay đổi" : "Lưu"}
        cancelText="Đóng"
        confirmLoading={saving}
        onCancel={closeCreate}
        onOk={() => void saveReceipt()}
        className="purchase-modal"
      >
        <Form<ReceiptForm> form={form} layout="vertical">
          <div className="purchase-head-grid">
            <Card size="small" title="Thông tin chung">
              <Form.Item
                label="Nhà cung cấp"
                required
              >
                <Space.Compact style={{ width: "100%" }}>
                  <Form.Item
                    name="supplier_id"
                    noStyle
                    rules={[{ required: true, message: "Chọn nhà cung cấp." }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="Chọn nhà cung cấp"
                      options={activeSuppliers.map((supplier) => ({
                        value: supplier.id,
                        label: supplier.name
                      }))}
                    />
                  </Form.Item>
                  <Button
                    className="quick-add-button"
                    onClick={() => {
                      quickSupplierForm.resetFields();
                      setQuickSupplierOpen(true);
                    }}
                  >
                    +
                  </Button>
                </Space.Compact>
              </Form.Item>
              <Form.Item label="Diễn giải" name="description">
                <Input placeholder="Ví dụ: Nhập hải sản buổi sáng" />
              </Form.Item>
            </Card>

            <Card size="small" title="Chứng từ">
              <Form.Item
                label="Ngày nhập"
                name="receipt_time"
                rules={[{ required: true, message: "Chọn ngày nhập." }]}
              >
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item
                label="Trạng thái"
                name="payment_status"
                rules={[{ required: true }]}
              >
                <Radio.Group disabled={editingReceipt !== null}>
                  <Radio value="PAID">Đã thanh toán</Radio>
                  <Radio value="DEBT">Trả nợ</Radio>
                </Radio.Group>
              </Form.Item>

              {paymentStatus === "PAID" && editingReceipt === null && (
                <div className="purchase-payment-grid">
                  <Form.Item
                    label="Loại tiền"
                    name="account_type"
                    rules={[{ required: true, message: "Chọn loại tiền." }]}
                  >
                    <Select
                      options={[
                        { value: "CASH", label: "Tiền mặt" },
                        { value: "BANK", label: "Tiền gửi" }
                      ]}
                      onChange={(nextType: FundAccountType) => {
                        const preferred =
                          accounts.find(
                            (account) =>
                              account.is_active &&
                              account.type === nextType &&
                              account.is_default
                          ) ??
                          accounts.find(
                            (account) =>
                              account.is_active && account.type === nextType
                          );
                        form.setFieldValue("fund_account_id", preferred?.id);
                      }}
                    />
                  </Form.Item>
                  <Form.Item
                    label="Quỹ / tài khoản"
                    name="fund_account_id"
                    rules={[{ required: true, message: "Chọn quỹ/tài khoản." }]}
                  >
                    <Select
                      placeholder="Chọn quỹ/tài khoản"
                      options={paymentAccounts.map((account) => ({
                        value: account.id,
                        label: account.name
                      }))}
                    />
                  </Form.Item>
                </div>
              )}
            </Card>
          </div>

          <Card size="small" title="Chi tiết hàng nhập" className="purchase-detail-card">
            <div className="purchase-line-header">
              <span>Hàng hóa</span>
              <span>ĐVT</span>
              <span>Số lượng</span>
              <span>Đơn giá</span>
              <span>Thành tiền</span>
              <span>Ghi chú</span>
              <span />
            </div>

            <div className="purchase-lines">
              {lines.map((line) => {
                const item = items.find((candidate) => candidate.id === line.item_id);
                const conversions = item?.conversions.filter((row) => row.is_active) ?? [];
                return (
                  <div className="purchase-line" key={line.key}>
                    <Space.Compact style={{ width: "100%" }}>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Chọn hàng hóa"
                        value={line.item_id}
                        onChange={(value) => chooseItem(line.key, value)}
                        options={activeItems.map((candidate) => ({
                          value: candidate.id,
                          label: candidate.name
                        }))}
                      />
                      <Button
                        className="quick-add-button"
                        title="Thêm nhanh hàng hóa"
                        onClick={() => openQuickItem(line.key)}
                      >
                        +
                      </Button>
                    </Space.Compact>

                    <Space.Compact style={{ width: "100%" }}>
                      <Select
                        value={line.unit_id}
                        placeholder="ĐVT"
                        disabled={!line.item_id}
                        onChange={(value) => updateLine(line.key, { unit_id: value })}
                        options={conversions.map((conversion) => ({
                          value: conversion.unit_id,
                          label: conversion.unit_name
                        }))}
                      />
                      <Button
                        className="quick-add-button"
                        disabled={!line.item_id}
                        title="Thêm nhanh quy đổi"
                        onClick={() => openQuickConversion(line)}
                      >
                        +
                      </Button>
                    </Space.Compact>

                    <InputNumber<number>
                      min={0.001}
                      value={line.quantity}
                      onChange={(value) => updateLine(line.key, { quantity: value ?? undefined })}
                      style={{ width: "100%" }}
                    />
                    <InputNumber<number>
                      min={0}
                      precision={0}
                      value={line.unit_price}
                      onChange={(value) => updateLine(line.key, { unit_price: value ?? undefined })}
                      style={{ width: "100%" }}
                      formatter={(value) =>
                        value === undefined || value === null ? "" : money(Number(value))
                      }
                      parser={(value) => Number((value ?? "").replace(/[^0-9]/g, ""))}
                    />
                    <div className="purchase-line-total">
                      {money((line.quantity ?? 0) * (line.unit_price ?? 0))}
                    </div>
                    <Input
                      value={line.note}
                      onChange={(event) => updateLine(line.key, { note: event.target.value })}
                      placeholder="Ghi chú"
                    />
                    <Button
                      danger
                      type="text"
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((current) => current.filter((row) => row.key !== line.key))
                      }
                    >
                      ×
                    </Button>
                  </div>
                );
              })}
            </div>

            <Button onClick={() => setLines((current) => [...current, newLine()])}>
              + Thêm dòng
            </Button>

            <div className="purchase-summary">
              <div className="purchase-shipping">
                <Form.Item label="Phí vận chuyển" name="shipping_fee">
                  <InputNumber<number>
                    min={0}
                    precision={0}
                    style={{ width: "100%" }}
                    formatter={(value) =>
                      value === undefined || value === null ? "" : money(Number(value))
                    }
                    parser={(value) => Number((value ?? "").replace(/[^0-9]/g, ""))}
                  />
                </Form.Item>
                <Text type="secondary">
                  Để trống hoặc 0 nếu không phát sinh. Dữ liệu này được lưu riêng để dùng khi tính giá vốn.
                </Text>
              </div>
              <div className="purchase-totals">
                <div><span>Tiền hàng</span><strong>{money(goodsTotal)} đ</strong></div>
                <div><span>Phí vận chuyển</span><strong>{money(shippingFee)} đ</strong></div>
                <div className="purchase-grand-total">
                  <span>Tổng thanh toán</span><strong>{money(totalAmount)} đ</strong>
                </div>
              </div>
            </div>
          </Card>
        </Form>
      </Modal>

      <Modal
        open={quickItemOpen}
        title="Thêm nhanh hàng hóa"
        width={500}
        okText="Lưu và chọn"
        cancelText="Hủy"
        confirmLoading={quickSaving}
        onCancel={() => {
          setQuickItemOpen(false);
          setQuickItemLineKey(null);
        }}
        onOk={() => void saveQuickItem()}
      >
        <Form<QuickItemForm> form={quickItemForm} layout="vertical">
          <Form.Item
            name="name"
            label="Tên hàng hóa"
            rules={[
              { required: true, whitespace: true, message: "Nhập tên hàng hóa." },
              { max: 150, message: "Tên hàng hóa tối đa 150 ký tự." }
            ]}
          >
            <Input autoFocus placeholder="Ví dụ: Bia Hà Nội, Ốc hương..." />
          </Form.Item>

          <Form.Item
            name="item_group_id"
            label="Nhóm hàng hóa"
            rules={[{ required: true, message: "Chọn nhóm hàng hóa." }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={itemGroups
                .filter((group) => group.is_active)
                .map((group) => ({ value: group.id, label: group.name }))}
            />
          </Form.Item>

          <Form.Item
            name="unit_id"
            label="Đơn vị"
            rules={[{ required: true, message: "Chọn đơn vị." }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={activeUnits.map((unit) => ({
                value: unit.id,
                label: unit.name
              }))}
            />
          </Form.Item>

          <Text type="secondary">
            Thêm nhanh dùng cùng một đơn vị cho mặc định và tồn kho. Nếu hàng nhập theo
            thùng/lốc nhưng tồn theo lon/chai, tạo hàng trước rồi bấm dấu + ở cột ĐVT để
            thêm quy đổi ngay trên phiếu.
          </Text>
        </Form>
      </Modal>

      <Modal
        open={quickSupplierOpen}
        title="Thêm nhanh nhà cung cấp"
        width={430}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={quickSaving}
        onCancel={() => setQuickSupplierOpen(false)}
        onOk={() => void saveQuickSupplier()}
      >
        <Form<QuickSupplierForm> form={quickSupplierForm} layout="vertical">
          <Form.Item
            name="name"
            label="Tên nhà cung cấp"
            rules={[{ required: true, whitespace: true, message: "Nhập tên nhà cung cấp." }]}
          >
            <Input autoFocus />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={quickConversionOpen}
        title={
          conversionItem
            ? `Thêm quy đổi - ${conversionItem.name}`
            : "Thêm quy đổi"
        }
        width={500}
        okText="Lưu quy đổi"
        cancelText="Hủy"
        confirmLoading={quickSaving}
        onCancel={() => setQuickConversionOpen(false)}
        onOk={() => void saveQuickConversion()}
      >
        {conversionItem && (
          <Form<QuickConversionForm> form={quickConversionForm} layout="vertical">
            <Form.Item
              name="unit_id"
              label="Đơn vị nhập"
              rules={[{ required: true, message: "Chọn đơn vị." }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={activeUnits
                  .filter(
                    (unit) =>
                      !conversionItem.conversions.some(
                        (conversion) => conversion.unit_id === unit.id
                      )
                  )
                  .map((unit) => ({ value: unit.id, label: unit.name }))}
              />
            </Form.Item>
            <Form.Item
              name="quantity_in_smallest_unit"
              label={`1 đơn vị nhập = bao nhiêu ${conversionItem.smallest_unit_name}`}
              rules={[{ required: true, message: "Nhập hệ số quy đổi." }]}
            >
              <InputNumber<number> min={0.001} style={{ width: "100%" }} />
            </Form.Item>
            <Text type="secondary">
              Quy đổi được lưu vào hàng hóa và sẽ dùng tự động cho các lần nhập sau.
            </Text>
          </Form>
        )}
      </Modal>

      <Modal
        open={viewReceipt !== null || viewLoading}
        title={viewReceipt ? `Phiếu nhập ${viewReceipt.receipt_code}` : "Phiếu nhập"}
        width={900}
        footer={
          !viewReceipt
            ? [<Button key="close" onClick={() => setViewReceipt(null)}>Đóng</Button>]
            : viewReceipt.is_void
              ? [
                  <Button key="close" onClick={() => setViewReceipt(null)}>Đóng</Button>,
                  ...(viewReceipt.replacement_receipt_id
                    ? []
                    : [
                        <Button key="reenter" type="primary" onClick={() => {
                          const receipt = viewReceipt;
                          setViewReceipt(null);
                          void openReentryReceipt(receipt);
                        }}>
                          Nhập lại
                        </Button>
                      ])
                ]
              : viewReceipt.payment_status === "DEBT"
                ? [
                    <Button key="close" onClick={() => setViewReceipt(null)}>Đóng</Button>,
                    <Button key="edit" onClick={() => {
                      const receipt = viewReceipt;
                      setViewReceipt(null);
                      void openEditReceipt(receipt);
                    }}>
                      Sửa
                    </Button>,
                    <Button key="pay" type="primary" onClick={() => {
                      const receipt = viewReceipt;
                      setViewReceipt(null);
                      payDebt(receipt);
                    }}>
                      Trả nợ
                    </Button>
                  ]
                : [
                    <Button key="close" onClick={() => setViewReceipt(null)}>Đóng</Button>,
                    <Button key="void" danger type="primary" onClick={() => voidAndReenter(viewReceipt)}>
                      Hủy để nhập lại
                    </Button>
                  ]
        }
        onCancel={() => setViewReceipt(null)}
      >
        {viewReceipt && (
          <>
            <div className="purchase-view-meta">
              <div><Text type="secondary">Nhà cung cấp</Text><strong>{viewReceipt.supplier_name}</strong></div>
              <div><Text type="secondary">Ngày nhập</Text><strong>{formatDateTime(viewReceipt.receipt_time)}</strong></div>
              <div>
                <Text type="secondary">Trạng thái</Text>
                <strong>
                  {viewReceipt.is_void
                    ? "Đã hủy"
                    : viewReceipt.payment_status === "PAID"
                      ? "Đã thanh toán"
                      : "Trả nợ"}
                </strong>
              </div>
              <div><Text type="secondary">Tổng tiền</Text><strong>{money(viewReceipt.total_amount)} đ</strong></div>
            </div>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={viewReceipt.items}
              columns={[
                { title: "Hàng hóa", dataIndex: "item_name" },
                { title: "ĐVT", dataIndex: "unit_name", width: 100 },
                { title: "Số lượng", dataIndex: "quantity", width: 110, align: "right" },
                { title: "Đơn giá", dataIndex: "unit_price", width: 130, align: "right", render: (value: number) => money(value) },
                { title: "Thành tiền", dataIndex: "line_total", width: 140, align: "right", render: (value: number) => money(value) },
                { title: "Ghi chú", dataIndex: "note" }
              ]}
            />
          </>
        )}
      </Modal>
    </>
  );
}
