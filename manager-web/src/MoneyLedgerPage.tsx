import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Table,
  Typography
} from "antd";
import type { TableProps } from "antd";

import {
  createFundTransaction,
  createFundTransactionCategory,
  getFundAccounts,
  getFundTransactionCategories,
  getFundTransactions
} from "./api";
import type {
  FundAccount,
  FundAccountType,
  FundTransaction,
  FundTransactionCategory,
  FundTransactionCreateInput,
  FundTransactionType,
  VoucherPrefill
} from "./types";

const { Title, Text } = Typography;
const { TextArea } = Input;

type LedgerRow = {
  key: string;
  transaction_time: string | null;
  receipt_code: string | null;
  payment_code: string | null;
  category_name: string | null;
  description: string;
  source_type: string | null;
  source_id: string | null;
  source_reference_code: string | null;
  amount_in: number;
  amount_out: number;
  running_balance: number;
  fund_account_name: string | null;
  is_opening?: boolean;
};

type VoucherDirection = "IN" | "OUT";

type VoucherForm = {
  account_type: FundAccountType;
  fund_account_id: number;
  transaction_type: FundTransactionType;
  transaction_time: string;
  category_id?: number;
  amount?: number;
  actual_balance?: number;
  related_fund_account_id?: number;
  description?: string;
  note?: string;
};

type QuickCategoryForm = {
  name: string;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function formatDate(value: string | null) {
  if (!value) return "";
  const datePart = value.slice(0, 10);
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalDateTimeInput(date: Date) {
  const day = toDateInput(date);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${day}T${hour}:${minute}`;
}

function currentMonthRange() {
  const now = new Date();
  return {
    from: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  };
}

function preferredAccount(
  accounts: FundAccount[],
  accountType: FundAccountType
) {
  return (
    accounts.find(
      (account) =>
        account.is_active &&
        account.type === accountType &&
        account.is_default
    ) ??
    accounts.find(
      (account) => account.is_active && account.type === accountType
    )
  );
}

function transactionToRow(item: FundTransaction): LedgerRow {
  return {
    key: String(item.id),
    transaction_time: item.transaction_time,
    receipt_code: item.direction === "IN" ? item.reference_code : null,
    payment_code: item.direction === "OUT" ? item.reference_code : null,
    category_name: item.category_name,
    description: item.description || item.note || item.transaction_type,
    source_type: item.source_type,
    source_id: item.source_id,
    source_reference_code: item.source_reference_code,
    amount_in: item.direction === "IN" ? item.amount : 0,
    amount_out: item.direction === "OUT" ? item.amount : 0,
    running_balance: item.running_balance,
    fund_account_name: item.fund_account_name
  };
}

function MoneyLedgerPage({
  accountType,
  title,
  accountLabel,
  initialVoucher,
  onInitialVoucherConsumed,
  onOpenSourceDocument
}: {
  accountType: FundAccountType;
  title: string;
  accountLabel: string;
  initialVoucher?: VoucherPrefill | null;
  onInitialVoucherConsumed?: () => void;
  onOpenSourceDocument?: (sourceType: string, sourceId: string) => void;
}) {
  const initialRange = useMemo(() => currentMonthRange(), []);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [allAccounts, setAllAccounts] = useState<FundAccount[]>([]);
  const [categories, setCategories] = useState<FundTransactionCategory[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | "all">("all");
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherDirection, setVoucherDirection] = useState<VoucherDirection>("IN");
  const [voucherSaving, setVoucherSaving] = useState(false);
  const [quickCategoryOpen, setQuickCategoryOpen] = useState(false);
  const [quickCategorySaving, setQuickCategorySaving] = useState(false);
  const [voucherSource, setVoucherSource] = useState<{
    source_type?: string | null;
    source_id?: string | null;
  } | null>(null);
  const [form] = Form.useForm<VoucherForm>();
  const [quickCategoryForm] = Form.useForm<QuickCategoryForm>();
  const transactionType = Form.useWatch("transaction_type", form);
  const voucherAccountType = Form.useWatch("account_type", form);
  const voucherAccountId = Form.useWatch("fund_account_id", form);
  const actualBalance = Form.useWatch("actual_balance", form);
  const [messageApi, messageContext] = message.useMessage();

  const loadAccounts = async () => {
    try {
      const [typed, all] = await Promise.all([
        getFundAccounts(accountType),
        getFundAccounts()
      ]);
      setAccounts(typed);
      setAllAccounts(all);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được danh sách quỹ."
      );
    }
  };

  const loadCategories = async () => {
    try {
      setCategories(await getFundTransactionCategories());
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được loại thu/chi."
      );
    }
  };

  const loadLedger = async () => {
    try {
      setLoading(true);
      const result = await getFundTransactions({
        account_type: accountType,
        fund_account_id:
          selectedAccountId === "all" ? undefined : selectedAccountId,
        from_date: fromDate || undefined,
        to_date: toDate || undefined
      });

      setRows([
        {
          key: "opening",
          transaction_time: null,
          receipt_code: null,
          payment_code: null,
          category_name: null,
          description: "Số tồn đầu kỳ",
          source_type: null,
          source_id: null,
          source_reference_code: null,
          amount_in: 0,
          amount_out: 0,
          running_balance: result.opening_balance,
          fund_account_name: null,
          is_opening: true
        },
        ...result.items.map(transactionToRow)
      ]);
      setTotalIn(result.total_in);
      setTotalOut(result.total_out);
      setClosingBalance(result.closing_balance);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được sổ tiền."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
    void loadCategories();
  }, [accountType]);

  useEffect(() => {
    void loadLedger();
  }, [accountType]);

  useEffect(() => {
    if (!initialVoucher || allAccounts.length === 0 || categories.length === 0) {
      return;
    }

    const firstAccount = preferredAccount(allAccounts, accountType);
    const category = categories.find(
      (item) =>
        item.is_active &&
        item.direction === initialVoucher.direction &&
        item.name.toLocaleLowerCase("vi") ===
          (initialVoucher.category_name ?? "").toLocaleLowerCase("vi")
    );

    setVoucherDirection(initialVoucher.direction);
    setVoucherSource({
      source_type: initialVoucher.source_type ?? null,
      source_id: initialVoucher.source_id ?? null
    });
    form.resetFields();
    form.setFieldsValue({
      account_type: accountType,
      fund_account_id: firstAccount?.id,
      transaction_type: "NORMAL",
      transaction_time: toLocalDateTimeInput(new Date()),
      category_id: category?.id,
      amount: initialVoucher.amount,
      description: initialVoucher.description,
      note: initialVoucher.note ?? undefined
    });
    setVoucherOpen(true);
    onInitialVoucherConsumed?.();
  }, [initialVoucher, allAccounts, categories, accountType]);

  const voucherAccounts = allAccounts.filter(
    (account) => account.is_active && account.type === voucherAccountType
  );

  const selectedVoucherAccount =
    allAccounts.find((account) => account.id === voucherAccountId) ?? null;

  const activeCategories = categories.filter(
    (category) =>
      category.is_active && category.direction === voucherDirection
  );

  const adjustmentDifference =
    transactionType === "BALANCE_ADJUSTMENT" &&
    selectedVoucherAccount &&
    actualBalance !== undefined &&
    actualBalance !== null
      ? actualBalance - selectedVoucherAccount.current_balance
      : null;

  const openVoucher = (direction: VoucherDirection) => {
    const firstAccount =
      selectedAccountId === "all"
        ? preferredAccount(accounts, accountType)
        : accounts.find(
            (account) => account.id === selectedAccountId && account.is_active
          );

    setVoucherDirection(direction);
    setVoucherSource(null);
    form.resetFields();
    form.setFieldsValue({
      account_type: accountType,
      fund_account_id: firstAccount?.id,
      transaction_type: "NORMAL",
      transaction_time: toLocalDateTimeInput(new Date())
    });
    setVoucherOpen(true);
  };

  const closeVoucher = () => {
    setVoucherOpen(false);
    setVoucherSource(null);
    form.resetFields();
  };

  const changeAccountType = (nextType: FundAccountType) => {
    const first = preferredAccount(allAccounts, nextType);
    form.setFieldsValue({
      account_type: nextType,
      fund_account_id: first?.id,
      related_fund_account_id: undefined
    });
  };

  const saveVoucher = async () => {
    try {
      const values = await form.validateFields();
      setVoucherSaving(true);

      const payload: FundTransactionCreateInput = {
        account_type: values.account_type,
        fund_account_id: values.fund_account_id,
        direction: voucherDirection,
        transaction_type: values.transaction_type,
        transaction_time: values.transaction_time,
        category_id:
          values.transaction_type === "NORMAL"
            ? values.category_id
            : undefined,
        amount:
          values.transaction_type === "BALANCE_ADJUSTMENT"
            ? undefined
            : values.amount,
        actual_balance:
          values.transaction_type === "BALANCE_ADJUSTMENT"
            ? values.actual_balance
            : undefined,
        related_fund_account_id:
          values.transaction_type === "TRANSFER"
            ? values.related_fund_account_id
            : undefined,
        description: values.description?.trim() || null,
        note: values.note?.trim() || null,
        source_type: voucherSource?.source_type ?? null,
        source_id: voucherSource?.source_id ?? null
      };

      const saved = await createFundTransaction(payload);
      closeVoucher();
      await loadAccounts();
      await loadLedger();
      messageApi.success(
        `Đã tạo ${voucherDirection === "IN" ? "phiếu thu" : "phiếu chi"} ${saved.reference_codes.join(", ")}.`
      );
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setVoucherSaving(false);
    }
  };

  const saveQuickCategory = async () => {
    try {
      const values = await quickCategoryForm.validateFields();
      setQuickCategorySaving(true);
      const created = await createFundTransactionCategory({
        name: values.name.trim(),
        direction: voucherDirection,
        is_active: true,
        sort_order: 0
      });
      await loadCategories();
      form.setFieldValue("category_id", created.id);
      setQuickCategoryOpen(false);
      quickCategoryForm.resetFields();
      messageApi.success(
        `Đã thêm loại ${voucherDirection === "IN" ? "thu" : "chi"}.`
      );
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setQuickCategorySaving(false);
    }
  };

  const transactionTypeOptions = [
    { value: "NORMAL", label: voucherDirection === "IN" ? "Thu tiền" : "Chi tiền" },
    { value: "TRANSFER", label: "Chuyển quỹ / chuyển tài khoản" },
    { value: "BALANCE_ADJUSTMENT", label: "Cân đối kiểm kê" },
    ...(voucherDirection === "IN"
      ? [{ value: "OPENING_BALANCE", label: "Số dư đầu kỳ" }]
      : [])
  ];

  const columns: TableProps<LedgerRow>["columns"] = [
    {
      title: "Ngày CT",
      dataIndex: "transaction_time",
      key: "transaction_time",
      width: "7%",
      render: (value: string | null, row) =>
        row.is_opening ? null : formatDate(value)
    },
    {
      title: "Phiếu thu",
      dataIndex: "receipt_code",
      key: "receipt_code",
      width: "11%",
      render: (value: string | null) => value || ""
    },
    {
      title: "Phiếu chi",
      dataIndex: "payment_code",
      key: "payment_code",
      width: "11%",
      render: (value: string | null) => value || ""
    },
    {
      title: "Loại thu/chi",
      width: "8%",
      dataIndex: "category_name",
      key: "category_name",
      render: (value: string | null) => value || ""
    },
    {
      title: "Diễn giải",
      dataIndex: "description",
      key: "description",
      width: "12%",
      render: (value: string, row) =>
        row.is_opening ? <Text strong>{value}</Text> : value
    },
    {
      title: "CT liên quan",
      key: "source_reference",
      width: "12%",
      render: (_, row) => {
        if (row.is_opening || !row.source_type || !row.source_id) {
          return "";
        }

        if (row.source_type === "PURCHASE_RECEIPT" || row.source_type === "SALE") {
          return (
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              title={row.source_reference_code || undefined}
              onClick={() =>
                onOpenSourceDocument?.(row.source_type as string, row.source_id as string)
              }
            >
              {row.source_reference_code || (row.source_type === "SALE" ? `Đơn bán #${row.source_id}` : `Phiếu nhập #${row.source_id}`)}
            </Button>
          );
        }

        return row.source_reference_code || "";
      }
    },
    {
      title: "Tiền thu",
      dataIndex: "amount_in",
      key: "amount_in",
      width: "9%",
      align: "right",
      render: (value: number, row) =>
        row.is_opening || value === 0 ? "" : formatMoney(value)
    },
    {
      title: "Tiền chi",
      dataIndex: "amount_out",
      key: "amount_out",
      width: "9%",
      align: "right",
      render: (value: number, row) =>
        row.is_opening || value === 0 ? "" : formatMoney(value)
    },
    {
      title: "Số dư",
      dataIndex: "running_balance",
      key: "running_balance",
      width: "11%",
      align: "right",
      render: (value: number) => <Text strong>{formatMoney(value)}</Text>
    },
    {
      title: accountType === "CASH" ? "Quỹ" : "Tài khoản",
      dataIndex: "fund_account_name",
      key: "fund_account_name",
      width: "10%",
      render: (value: string | null, row) =>
        row.is_opening ? "" : value || ""
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>{title}</Title>
          <Text type="secondary">
            Theo dõi toàn bộ phát sinh thu, chi và số dư theo thời gian.
          </Text>
        </div>

        <Space>
          <Button size="large" onClick={() => openVoucher("OUT")}>
            − Phiếu chi
          </Button>
          <Button type="primary" size="large" onClick={() => openVoucher("IN")}>
            + Phiếu thu
          </Button>
        </Space>
      </div>

      <div className="toolbar">
        <Space wrap size="middle">
          <div>
            <Text type="secondary">Từ ngày</Text>
            <Input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              style={{ width: 155, marginLeft: 8 }}
            />
          </div>

          <div>
            <Text type="secondary">Đến ngày</Text>
            <Input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              style={{ width: 155, marginLeft: 8 }}
            />
          </div>

          <Select<number | "all">
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            style={{ minWidth: 240 }}
            options={[
              { value: "all", label: `Tất cả ${accountLabel.toLowerCase()}` },
              ...accounts.map((account) => ({
                value: account.id,
                label: account.name
              }))
            ]}
          />

          <Button type="primary" onClick={() => void loadLedger()}>
            Lấy dữ liệu
          </Button>
        </Space>
      </div>

      <div className="table-card">
        <Table<LedgerRow>
          className="money-ledger-table"
          tableLayout="fixed"
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: "Chưa có phát sinh." }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6}>
                <Text strong>Tổng phát sinh trong kỳ</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <Text strong>{formatMoney(totalIn)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right">
                <Text strong>{formatMoney(totalOut)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={8} align="right">
                <Text strong>{formatMoney(closingBalance)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={9} />
            </Table.Summary.Row>
          )}
        />
      </div>

      <Modal
        open={voucherOpen}
        width={650}
        title={voucherDirection === "IN" ? "Phiếu thu" : "Phiếu chi"}
        okText="Lưu phiếu"
        cancelText="Hủy"
        confirmLoading={voucherSaving}
        onCancel={closeVoucher}
        onOk={() => void saveVoucher()}
      >
        <Form<VoucherForm> form={form} layout="vertical">
          <div className="supplier-form-grid">
            <Form.Item
              label="Loại tiền"
              name="account_type"
              rules={[{ required: true, message: "Chọn loại tiền." }]}
            >
              <Select
                onChange={changeAccountType}
                options={[
                  { value: "CASH", label: "Tiền mặt" },
                  { value: "BANK", label: "Tiền gửi" }
                ]}
              />
            </Form.Item>

            <Form.Item
              label="Quỹ / tài khoản"
              name="fund_account_id"
              rules={[{ required: true, message: "Chọn quỹ / tài khoản." }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Chọn quỹ / tài khoản"
                options={voucherAccounts.map((account) => ({
                  value: account.id,
                  label: `${account.name} — ${formatMoney(account.current_balance)} đ`
                }))}
              />
            </Form.Item>
          </div>

          <div className="supplier-form-grid">
            <Form.Item
              label="Ngày chứng từ"
              name="transaction_time"
              rules={[{ required: true, message: "Chọn ngày chứng từ." }]}
            >
              <Input type="datetime-local" />
            </Form.Item>

            <Form.Item
              label="Loại giao dịch"
              name="transaction_type"
              rules={[{ required: true, message: "Chọn loại giao dịch." }]}
            >
              <Select options={transactionTypeOptions} />
            </Form.Item>
          </div>

          {transactionType === "NORMAL" && (
            <Form.Item label="Loại thu/chi" required>
              <Space.Compact style={{ width: "100%" }}>
                <Form.Item
                  name="category_id"
                  noStyle
                  rules={[{ required: true, message: "Chọn loại thu/chi." }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder={voucherDirection === "IN" ? "Chọn loại thu" : "Chọn loại chi"}
                    options={activeCategories.map((category) => ({
                      value: category.id,
                      label: category.name
                    }))}
                  />
                </Form.Item>
                <Button
                  type="default"
                  aria-label="Thêm nhanh loại thu chi"
                  onClick={() => {
                    quickCategoryForm.resetFields();
                    setQuickCategoryOpen(true);
                  }}
                >
                  +
                </Button>
              </Space.Compact>
            </Form.Item>
          )}

          {transactionType === "TRANSFER" && (
            <Form.Item
              label={
                voucherDirection === "OUT"
                  ? "Chuyển đến quỹ / tài khoản"
                  : "Nhận từ quỹ / tài khoản"
              }
              name="related_fund_account_id"
              rules={[{ required: true, message: "Chọn quỹ/tài khoản đối ứng." }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Chọn quỹ/tài khoản"
                options={allAccounts
                  .filter(
                    (account) =>
                      account.is_active && account.id !== voucherAccountId
                  )
                  .map((account) => ({
                    value: account.id,
                    label: `${account.name} (${account.type === "CASH" ? "Tiền mặt" : "Tiền gửi"})`
                  }))}
              />
            </Form.Item>
          )}

          {transactionType === "BALANCE_ADJUSTMENT" ? (
            <>
              <div className="supplier-form-grid">
                <Form.Item label="Số dư hệ thống">
                  <Input
                    disabled
                    value={
                      selectedVoucherAccount
                        ? `${formatMoney(selectedVoucherAccount.current_balance)} đ`
                        : ""
                    }
                  />
                </Form.Item>

                <Form.Item
                  label="Số tiền thực tế"
                  name="actual_balance"
                  rules={[{ required: true, message: "Nhập số tiền thực tế." }]}
                >
                  <InputNumber<number>
                    min={0}
                    precision={0}
                    style={{ width: "100%" }}
                    formatter={(value) =>
                      value === undefined || value === null
                        ? ""
                        : new Intl.NumberFormat("vi-VN").format(Number(value))
                    }
                    parser={(value) =>
                      Number((value ?? "").replace(/[^0-9]/g, ""))
                    }
                  />
                </Form.Item>
              </div>

              <Form.Item label="Chênh lệch">
                <Input
                  disabled
                  value={
                    adjustmentDifference === null
                      ? ""
                      : `${adjustmentDifference > 0 ? "+" : ""}${formatMoney(adjustmentDifference)} đ`
                  }
                />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              label={
                transactionType === "OPENING_BALANCE"
                  ? "Số dư đầu kỳ"
                  : "Số tiền"
              }
              name="amount"
              rules={[{ required: true, message: "Nhập số tiền." }]}
            >
              <InputNumber<number>
                min={1}
                precision={0}
                style={{ width: "100%" }}
                formatter={(value) =>
                  value === undefined || value === null
                    ? ""
                    : new Intl.NumberFormat("vi-VN").format(Number(value))
                }
                parser={(value) =>
                  Number((value ?? "").replace(/[^0-9]/g, ""))
                }
              />
            </Form.Item>
          )}

          <Form.Item
            label={transactionType === "NORMAL" ? "Mục đích thu/chi" : "Diễn giải"}
            name="description"
            rules={
              transactionType === "NORMAL"
                ? [{ required: true, whitespace: true, message: "Nhập mục đích thu/chi." }]
                : undefined
            }
          >
            <Input
              placeholder={
                transactionType === "OPENING_BALANCE"
                  ? "Số dư khi bắt đầu sử dụng OC11"
                  : transactionType === "NORMAL"
                    ? "Nhập mục đích thu/chi..."
                    : "Nội dung giao dịch"
              }
            />
          </Form.Item>

          <Form.Item label="Ghi chú" name="note">
            <TextArea rows={3} placeholder="Ghi chú không bắt buộc..." />
          </Form.Item>

          {transactionType === "BALANCE_ADJUSTMENT" &&
            adjustmentDifference !== null &&
            adjustmentDifference !== 0 && (
              <Text type="secondary">
                Chênh lệch này cần tạo bằng{" "}
                <Text strong>
                  {adjustmentDifference > 0 ? "Phiếu thu" : "Phiếu chi"}
                </Text>.
              </Text>
            )}
        </Form>
      </Modal>

      <Modal
        open={quickCategoryOpen}
        width={430}
        title={voucherDirection === "IN" ? "Thêm loại thu" : "Thêm loại chi"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={quickCategorySaving}
        onCancel={() => setQuickCategoryOpen(false)}
        onOk={() => void saveQuickCategory()}
      >
        <Form<QuickCategoryForm> form={quickCategoryForm} layout="vertical">
          <Form.Item
            label="Tên loại"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "Nhập tên loại thu/chi." }
            ]}
          >
            <Input autoFocus placeholder={voucherDirection === "IN" ? "Ví dụ: Thu khác" : "Ví dụ: Điện nước"} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export function CashLedgerPage({
  initialVoucher,
  onInitialVoucherConsumed,
  onOpenSourceDocument
}: {
  initialVoucher?: VoucherPrefill | null;
  onInitialVoucherConsumed?: () => void;
  onOpenSourceDocument?: (sourceType: string, sourceId: string) => void;
}) {
  return (
    <MoneyLedgerPage
      accountType="CASH"
      title="Sổ tiền mặt"
      accountLabel="Quỹ tiền mặt"
      initialVoucher={initialVoucher}
      onInitialVoucherConsumed={onInitialVoucherConsumed}
      onOpenSourceDocument={onOpenSourceDocument}
    />
  );
}

export function BankLedgerPage({
  initialVoucher,
  onInitialVoucherConsumed,
  onOpenSourceDocument
}: {
  initialVoucher?: VoucherPrefill | null;
  onInitialVoucherConsumed?: () => void;
  onOpenSourceDocument?: (sourceType: string, sourceId: string) => void;
}) {
  return (
    <MoneyLedgerPage
      accountType="BANK"
      title="Sổ tiền gửi"
      accountLabel="Tài khoản ngân hàng"
      initialVoucher={initialVoucher}
      onInitialVoucherConsumed={onInitialVoucherConsumed}
      onOpenSourceDocument={onOpenSourceDocument}
    />
  );
}
