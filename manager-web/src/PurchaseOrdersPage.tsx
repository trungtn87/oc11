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
  createPurchaseReceipt,
  createSupplier,
  getFundAccounts,
  getInventoryItems,
  getPurchaseReceipt,
  getPurchaseReceipts,
  getSuppliers,
  getUnits,
  updateInventoryItem
} from "./api";
import type {
  FundAccount,
  FundAccountType,
  InventoryItem,
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

export default function PurchaseOrdersPage({ onPayDebt }: PurchaseOrdersPageProps) {
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<PurchasePaymentStatus | "all">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [lines, setLines] = useState<ReceiptLineDraft[]>([newLine()]);
  const [quickSupplierOpen, setQuickSupplierOpen] = useState(false);
  const [quickConversionOpen, setQuickConversionOpen] = useState(false);
  const [conversionLineKey, setConversionLineKey] = useState<string | null>(null);
  const [conversionItem, setConversionItem] = useState<InventoryItem | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);
  const [viewReceipt, setViewReceipt] = useState<PurchaseReceipt | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [form] = Form.useForm<ReceiptForm>();
  const [quickSupplierForm] = Form.useForm<QuickSupplierForm>();
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
    const [nextSuppliers, nextItems, nextUnits, nextAccounts] = await Promise.all([
      getSuppliers(),
      getInventoryItems(),
      getUnits(),
      getFundAccounts()
    ]);
    setSuppliers(nextSuppliers);
    setItems(nextItems);
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
    form.resetFields();
    form.setFieldsValue({
      receipt_time: toLocalDateTimeInput(new Date()),
      shipping_fee: 0,
      payment_status: "DEBT"
    });
    setLines([newLine()]);
    setModalOpen(true);
  };

  const closeCreate = () => {
    setModalOpen(false);
    setLines([newLine()]);
    form.resetFields();
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
        items: lines.map((line) => ({
          item_id: line.item_id as number,
          unit_id: line.unit_id as number,
          quantity: line.quantity as number,
          unit_price: line.unit_price as number,
          note: line.note?.trim() || null
        }))
      };

      setSaving(true);
      await createPurchaseReceipt(payload);
      closeCreate();
      await Promise.all([loadReceipts(), loadMasterData()]);
      messageApi.success("Đã lưu phiếu nhập và cập nhật tồn kho.");
    } catch (error) {
      if (error instanceof Error) messageApi.error(error.message);
    } finally {
      setSaving(false);
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
      render: (value: PurchasePaymentStatus) =>
        value === "PAID" ? (
          <Tag color="success">Đã thanh toán</Tag>
        ) : (
          <Tag color="gold">Trả nợ</Tag>
        )
    },
    {
      title: "Thao tác",
      key: "actions",
      width: 125,
      render: (_, row) =>
        row.payment_status === "DEBT" ? (
          <Button type="link" onClick={() => payDebt(row)}>
            Trả nợ
          </Button>
        ) : (
          <Text type="secondary">{row.payment_reference_code || ""}</Text>
        )
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
        />
      </div>

      <Modal
        open={modalOpen}
        width="min(1180px, 96vw)"
        title="Thêm phiếu nhập hàng"
        okText="Lưu"
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
                <Radio.Group>
                  <Radio value="PAID">Đã thanh toán</Radio>
                  <Radio value="DEBT">Trả nợ</Radio>
                </Radio.Group>
              </Form.Item>

              {paymentStatus === "PAID" && (
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
                      onChange={() => form.setFieldValue("fund_account_id", undefined)}
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
          viewReceipt?.payment_status === "DEBT"
            ? [
                <Button key="close" onClick={() => setViewReceipt(null)}>Đóng</Button>,
                <Button key="pay" type="primary" onClick={() => {
                  const receipt = viewReceipt;
                  setViewReceipt(null);
                  payDebt(receipt);
                }}>
                  Trả nợ
                </Button>
              ]
            : [<Button key="close" onClick={() => setViewReceipt(null)}>Đóng</Button>]
        }
        onCancel={() => setViewReceipt(null)}
      >
        {viewReceipt && (
          <>
            <div className="purchase-view-meta">
              <div><Text type="secondary">Nhà cung cấp</Text><strong>{viewReceipt.supplier_name}</strong></div>
              <div><Text type="secondary">Ngày nhập</Text><strong>{formatDateTime(viewReceipt.receipt_time)}</strong></div>
              <div><Text type="secondary">Trạng thái</Text><strong>{viewReceipt.payment_status === "PAID" ? "Đã thanh toán" : "Trả nợ"}</strong></div>
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
