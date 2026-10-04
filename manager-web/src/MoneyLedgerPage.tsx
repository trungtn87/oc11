import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  message,
  Select,
  Space,
  Table,
  Typography
} from "antd";
import type { TableProps } from "antd";

import { getFundAccounts, getFundTransactions } from "./api";
import type {
  FundAccount,
  FundAccountType,
  FundTransaction
} from "./types";

const { Title, Text } = Typography;

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
  const [selectedAccountId, setSelectedAccountId] = useState<number | "all">("all");
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);
  const [messageApi, messageContext] = message.useMessage();

  const loadAccounts = async () => {
    try {
      setAccounts(await getFundAccounts(accountType));
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
      width: 130,
      render: (value: string | null) => value || ""
    },
    {
      title: "Số phiếu chi",
      dataIndex: "payment_code",
      key: "payment_code",
      width: 130,
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
