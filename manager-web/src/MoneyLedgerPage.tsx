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
  getFundAccounts,
  getFundTransactions
} from "./api";
import type {
  FundAccount,
  FundAccountType,
  FundTransaction,
  FundTransactionCreateInput,
  FundTransactionType
} from "./types";

const { Title, Text } = Typography;
const { TextArea } = Input;

type LedgerRow = {
  key: string;
  transaction_time: string | null;
  receipt_code: string | null;
  payment_code: string | null;
  description: string;
  amount_in: number;
  amount_out: number;
  running_balance: number;
  fund_account_name: string | null;
  is_opening?: boolean;
};

type VoucherDirection = "IN" | "OUT";

type VoucherForm = {
  fund_account_id: number;
  transaction_type: FundTransactionType;
  transaction_time: string;
  amount?: number;
  actual_balance?: number;
  related_fund_account_id?: number;
  description?: string;
  note?: string;
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

function transactionToRow(item: FundTransaction): LedgerRow {
  return {
    key: String(item.id),
    transaction_time: item.transaction_time,
    receipt_code: item.direction === "IN" ? item.reference_code : null,
    payment_code: item.direction === "OUT" ? item.reference_code : null,
    description: item.description || item.note || item.transaction_type,
    amount_in: item.direction === "IN" ? item.amount : 0,
    amount_out: item.direction === "OUT" ? item.amount : 0,
    running_balance: item.running_balance,
    fund_account_name: item.fund_account_name
  };
}

function MoneyLedgerPage({
  accountType,
  title,
  accountLabel
}: {
  accountType: FundAccountType;
  title: string;
  accountLabel: string;
}) {
  const initialRange = useMemo(() => currentMonthRange(), []);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [allAccounts, setAllAccounts] = useState<FundAccount[]>([]);
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
  const [form] = Form.useForm<VoucherForm>();
  const transactionType = Form.useWatch("transaction_type", form);
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
          description: "Số tồn đầu kỳ",
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
  }, [accountType]);

  useEffect(() => {
    void loadLedger();
  }, [accountType]);

  const selectedVoucherAccount =
    accounts.find((account) => account.id === voucherAccountId) ?? null;

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
        ? accounts.find((account) => account.is_active)
        : accounts.find(
            (account) => account.id === selectedAccountId && account.is_active
          );

    setVoucherDirection(direction);
    form.resetFields();
    form.setFieldsValue({
      fund_account_id: firstAccount?.id,
      transaction_type: "NORMAL",
      transaction_time: toLocalDateTimeInput(new Date())
    });
    setVoucherOpen(true);
  };

  const closeVoucher = () => {
    setVoucherOpen(false);
    form.resetFields();
  };

  const saveVoucher = async () => {
    try {
      const values = await form.validateFields();
      setVoucherSaving(true);

      const payload: FundTransactionCreateInput = {
        account_type: accountType,
        fund_account_id: values.fund_account_id,
        direction: voucherDirection,
        transaction_type: values.transaction_type,
        transaction_time: values.transaction_time,
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
        note: values.note?.trim() || null
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
      title: "Ngày chứng từ",
      dataIndex: "transaction_time",
      key: "transaction_time",
      width: 125,
      render: (value: string | null, row) =>
        row.is_opening ? null : formatDate(value)
    },
    {
      title: "Số phiếu thu",
      dataIndex: "receipt_code",
      key: "receipt_code",
      width: 135,
      render: (value: string | null) => value || ""
    },
    {
      title: "Số phiếu chi",
      dataIndex: "payment_code",
      key: "payment_code",
      width: 135,
      render: (value: string | null) => value || ""
    },
    {
      title: "Diễn giải",
      dataIndex: "description",
      key: "description",
      render: (value: string, row) =>
        row.is_opening ? <Text strong>{value}</Text> : value
    },
    {
      title: "Số tiền thu",
      dataIndex: "amount_in",
      key: "amount_in",
      width: 145,
      align: "right",
      render: (value: number, row) =>
        row.is_opening || value === 0 ? "" : formatMoney(value)
    },
    {
      title: "Số tiền chi",
      dataIndex: "amount_out",
      key: "amount_out",
      width: 145,
      align: "right",
      render: (value: number, row) =>
        row.is_opening || value === 0 ? "" : formatMoney(value)
    },
    {
      title: "Số tiền còn lại",
      dataIndex: "running_balance",
      key: "running_balance",
      width: 160,
      align: "right",
      render: (value: number) => <Text strong>{formatMoney(value)}</Text>
    },
    {
      title: accountLabel,
      dataIndex: "fund_account_name",
      key: "fund_account_name",
      width: 190,
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
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1200 }}
          locale={{ emptyText: "Chưa có phát sinh." }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <Text strong>Tổng phát sinh trong kỳ</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                <Text strong>{formatMoney(totalIn)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right">
                <Text strong>{formatMoney(totalOut)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <Text strong>{formatMoney(closingBalance)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={7} />
            </Table.Summary.Row>
          )}
        />
      </div>

      <Modal
        open={voucherOpen}
        width={620}
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
              label={accountLabel}
              name="fund_account_id"
              rules={[{ required: true, message: `Chọn ${accountLabel.toLowerCase()}.` }]}
            >
              <Select
                placeholder={`Chọn ${accountLabel.toLowerCase()}`}
                options={accounts
                  .filter((account) => account.is_active)
                  .map((account) => ({
                    value: account.id,
                    label: `${account.name} — ${formatMoney(account.current_balance)} đ`
                  }))}
              />
            </Form.Item>

            <Form.Item
              label="Ngày chứng từ"
              name="transaction_time"
              rules={[{ required: true, message: "Chọn ngày chứng từ." }]}
            >
              <Input type="datetime-local" />
            </Form.Item>
          </div>

          <Form.Item
            label="Loại giao dịch"
            name="transaction_type"
            rules={[{ required: true, message: "Chọn loại giao dịch." }]}
          >
            <Select options={transactionTypeOptions} />
          </Form.Item>

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
                    label: `${account.name} (${account.type === "CASH" ? "Tiền mặt" : "Ngân hàng"})`
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

          <Form.Item label="Diễn giải" name="description">
            <Input
              placeholder={
                transactionType === "OPENING_BALANCE"
                  ? "Số dư khi bắt đầu sử dụng OC11"
                  : "Nội dung thu / chi"
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
    </>
  );
}

export function CashLedgerPage() {
  return (
    <MoneyLedgerPage
      accountType="CASH"
      title="Sổ tiền mặt"
      accountLabel="Quỹ tiền mặt"
    />
  );
}

export function BankLedgerPage() {
  return (
    <MoneyLedgerPage
      accountType="BANK"
      title="Sổ tiền gửi"
      accountLabel="Tài khoản ngân hàng"
    />
  );
}
