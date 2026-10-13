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
  deleteFundTransaction,
  getFundAccounts,
  getFundTransactionCategories,
  getFundTransactions,
  updateFundTransaction
} from "./api";
import type {
  FundAccount,
  FundAccountType,
  FundTransaction,
  FundTransactionCategory,
  FundTransactionUpdateInput
} from "./types";

const { Title, Text } = Typography;
const { TextArea } = Input;

type DirectionFilter = "all" | "IN" | "OUT";
type VoucherForm = FundTransactionUpdateInput & { account_type: FundAccountType };

function localDay(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonth() {
  const today = new Date();
  return {
    from: localDay(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: localDay(new Date(today.getFullYear(), today.getMonth() + 1, 0))
  };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function formatDateTime(value: string) {
  const [datePart, timePart] = value.replace(" ", "T").split("T");
  const [year, month, day] = datePart.split("-");
  return `${day}/${month}/${year}${timePart ? " " + timePart.slice(0, 5) : ""}`;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase();
}

function canEdit(transaction: FundTransaction) {
  // The API also enforces this; UI disable is only a convenience.
  return (
    transaction.transaction_type === "NORMAL" &&
    !transaction.source_type &&
    !transaction.source_id
  );
}

export default function FundVouchersPage({
  onOpenSourceDocument
}: {
  onOpenSourceDocument?: (sourceType: string, sourceId: string) => void;
}) {
  const range = useMemo(() => currentMonth(), []);
  const [fromDate, setFromDate] = useState(range.from);
  const [toDate, setToDate] = useState(range.to);
  const [accountFilter, setAccountFilter] = useState<number | "all">("all");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [categories, setCategories] = useState<FundTransactionCategory[]>([]);
  const [vouchers, setVouchers] = useState<FundTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FundTransaction | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<VoucherForm>();
  const accountType = Form.useWatch("account_type", form);
  const [messageApi, messageContext] = message.useMessage();

  const loadAccounts = async () => {
    try {
      setAccounts(await getFundAccounts());
      setCategories(await getFundTransactionCategories());
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không tải được danh mục thu chi.");
    }
  };

  const loadVouchers = async () => {
    if (fromDate && toDate && fromDate > toDate) {
      messageApi.error("Từ ngày không được lớn hơn đến ngày.");
      return;
    }
    try {
      setLoading(true);
      const params = { from_date: fromDate || undefined, to_date: toDate || undefined };
      const [cash, bank] = await Promise.all([
        getFundTransactions({ ...params, account_type: "CASH" }),
        getFundTransactions({ ...params, account_type: "BANK" })
      ]);
      setVouchers(
        [...cash.items, ...bank.items].sort(
          (a, b) =>
            b.transaction_time.localeCompare(a.transaction_time) || b.id - a.id
        )
      );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không tải được sổ thu chi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
    void loadVouchers();
  }, []);

  const filtered = useMemo(() => {
    const query = normalizeSearch(keyword.trim());
    return vouchers.filter((voucher) => {
      if (accountFilter !== "all" && voucher.fund_account_id !== accountFilter) return false;
      if (directionFilter !== "all" && voucher.direction !== directionFilter) return false;
      if (!query) return true;
      return normalizeSearch([
        voucher.reference_code ?? "",
        voucher.category_name ?? "",
        voucher.fund_account_name,
        voucher.description ?? "",
        voucher.source_reference_code ?? "",
        voucher.note ?? ""
      ].join(" ")).includes(query);
    });
  }, [vouchers, accountFilter, directionFilter, keyword]);

  const totalIn = filtered.reduce(
    (sum, voucher) => sum + (voucher.direction === "IN" ? voucher.amount : 0), 0
  );
  const totalOut = filtered.reduce(
    (sum, voucher) => sum + (voucher.direction === "OUT" ? voucher.amount : 0), 0
  );

  const openVoucher = (voucher: FundTransaction, edit = false) => {
    setSelected(voucher);
    setEditing(edit && canEdit(voucher));
    form.resetFields();
    form.setFieldsValue({
      account_type: voucher.account_type,
      fund_account_id: voucher.fund_account_id,
      transaction_time: voucher.transaction_time.replace(" ", "T").slice(0, 16),
      category_id: voucher.category_id ?? undefined,
      amount: voucher.amount,
      description: voucher.description,
      note: voucher.note
    });
  };

  const closeVoucher = () => {
    setSelected(null);
    setEditing(false);
    form.resetFields();
  };

  const changeAccountType = (type: FundAccountType) => {
    form.setFieldsValue({
      account_type: type,
      fund_account_id: accounts.find((account) => account.type === type && account.is_active)?.id
    });
  };

  const save = async () => {
    if (!selected || !canEdit(selected)) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      await updateFundTransaction(selected.id, {
        fund_account_id: values.fund_account_id,
        transaction_time: values.transaction_time,
        category_id: values.category_id,
        amount: values.amount,
        description: values.description?.trim() || null,
        note: values.note?.trim() || null
      });
      closeVoucher();
      await Promise.all([loadVouchers(), loadAccounts()]);
      messageApi.success("Đã cập nhật phiếu và số dư quỹ.");
    } catch (error) {
      if (error instanceof Error) messageApi.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteVoucher = (voucher: FundTransaction) => {
    if (!canEdit(voucher)) return;
    Modal.confirm({
      title: `Xóa phiếu ${voucher.reference_code || voucher.id}?`,
      content: "Phiếu sẽ bị hủy và hoàn nguyên số dư quỹ. Lịch sử chứng từ vẫn được lưu.",
      okText: "Xóa phiếu",
      okButtonProps: { danger: true },
      cancelText: "Không",
      onOk: async () => {
        try {
          await deleteFundTransaction(voucher.id);
          closeVoucher();
          await Promise.all([loadVouchers(), loadAccounts()]);
          messageApi.success("Đã hủy phiếu và cập nhật số dư.");
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : "Không xóa được phiếu.");
          throw error;
        }
      }
    });
  };

  const columns: TableProps<FundTransaction>["columns"] = [
    {
      title: "Ngày CT",
      dataIndex: "transaction_time",
      width: 125,
      render: (value: string) => formatDateTime(value)
    },
    {
      title: "Mã phiếu",
      dataIndex: "reference_code",
      width: 143,
      render: (value: string | null) => <Text strong>{value || "—"}</Text>
    },
    {
      title: "Thu/Chi",
      dataIndex: "direction",
      width: 72,
      render: (value: string) => value === "IN" ? "Thu" : "Chi"
    },
    {
      title: "Loại thu/chi",
      dataIndex: "category_name",
      width: 140,
      render: (value: string | null) => value || "—"
    },
    {
      title: "Quỹ / Tài khoản",
      dataIndex: "fund_account_name",
      width: 140
    },
    {
      title: "Số tiền",
      dataIndex: "amount",
      align: "right",
      width: 120,
      render: (value: number, row) => (
        <Text>{row.direction === "OUT" ? "−" : "+"}{formatMoney(value)}</Text>
      )
    },
    {
      title: "Diễn giải",
      dataIndex: "description",
      ellipsis: true,
      render: (value: string | null, row) => (
        value || row.source_reference_code || "—"
      )
    },
    {
      title: "Thao tác",
      width: 125,
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" disabled={!canEdit(row)}
            onClick={(event) => { event.stopPropagation(); openVoucher(row, true); }}>
            Sửa
          </Button>
          <Button danger type="link" size="small" disabled={!canEdit(row)}
            onClick={(event) => { event.stopPropagation(); deleteVoucher(row); }}>
            Xóa
          </Button>
        </Space>
      )
    }
  ];

  const selectedEditable = selected !== null && canEdit(selected);
  const availableCategories = categories.filter(
    (item) =>
      selected &&
      item.direction === selected.direction &&
      (item.is_active || item.id === selected.category_id)
  );

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Sổ thu chi</Title>
          <Text type="secondary">
            Danh sách phiếu thu, phiếu chi từ tất cả quỹ tiền mặt và tài khoản ngân hàng.
          </Text>
        </div>
      </div>
      <div className="toolbar">
        <Space wrap size="middle">
          <span>
            <Text type="secondary">Từ ngày</Text>
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)}
              style={{ width: 150, marginLeft: 8 }} />
          </span>
          <span>
            <Text type="secondary">Đến ngày</Text>
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)}
              style={{ width: 150, marginLeft: 8 }} />
          </span>
          <Button type="primary" onClick={() => void loadVouchers()}>Lấy dữ liệu</Button>
        </Space>
      </div>
      <div className="toolbar">
        <Space wrap size="middle">
          <Input.Search
            allowClear placeholder="Tìm mã phiếu, nội dung..."
            value={keyword} onChange={(event) => setKeyword(event.target.value)}
            style={{ width: 260 }}
          />
          <Select<DirectionFilter>
            value={directionFilter} onChange={setDirectionFilter}
            style={{ width: 125 }}
            options={[
              { value: "all", label: "Tất cả phiếu" },
              { value: "IN", label: "Phiếu thu" },
              { value: "OUT", label: "Phiếu chi" }
            ]}
          />
          <Select<number | "all">
            value={accountFilter} onChange={setAccountFilter}
            style={{ minWidth: 220 }}
            options={[
              { value: "all", label: "Tất cả quỹ/tài khoản" },
              ...accounts.map((account) => ({
                value: account.id,
                label: account.name
              }))
            ]}
          />
          <Text type="secondary">{filtered.length} phiếu</Text>
        </Space>
      </div>
      <div className="table-card">
        <Table<FundTransaction>
          rowKey="id" size="small" tableLayout="fixed"
          columns={columns} dataSource={filtered} loading={loading}
          scroll={{ x: 1140 }} pagination={{ pageSize: 30, showSizeChanger: false }}
          locale={{ emptyText: "Không có phiếu thu/chi trong kỳ." }}
          onRow={(row) => ({
            onClick: () => openVoucher(row),
            className: "supplier-row"
          })}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={5}><Text strong>Tổng phát sinh đang lọc</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right" colSpan={3}>
                <Text strong>Thu: {formatMoney(totalIn)} đ — Chi: {formatMoney(totalOut)} đ</Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </div>

      <Modal
        open={selected !== null}
        width={650}
        title={selected?.direction === "IN" ? `Phiếu thu ${selected?.reference_code || ""}` : `Phiếu chi ${selected?.reference_code || ""}`}
        onCancel={closeVoucher}
        footer={
          editing ? (
            <Space>
              <Button onClick={() => setEditing(false)}>Hủy</Button>
              <Button type="primary" loading={saving} onClick={() => void save()}>Lưu thay đổi</Button>
            </Space>
          ) : (
            <div className="supplier-modal-footer">
              <Button danger disabled={!selectedEditable} onClick={() => selected && deleteVoucher(selected)}>Xóa</Button>
              <Space>
                <Button onClick={closeVoucher}>Đóng</Button>
                <Button type="primary" disabled={!selectedEditable} onClick={() => setEditing(true)}>Sửa</Button>
              </Space>
            </div>
          )
        }
      >
        {selected && (
          <>
            {!selectedEditable && (
              <Text type="secondary">
                Giao dịch tự động hoặc giao dịch đặc biệt chỉ được xem tại đây.
                {selected.source_type && selected.source_id && onOpenSourceDocument && (
                  <Button type="link" onClick={() => {
                    onOpenSourceDocument(selected.source_type as string, selected.source_id as string);
                    closeVoucher();
                  }}>
                    Mở chứng từ nguồn {selected.source_reference_code || ""}
                  </Button>
                )}
              </Text>
            )}
            <Form<VoucherForm> form={form} layout="vertical" disabled={!editing}>
              <div className="supplier-form-grid">
                <Form.Item label="Loại tiền" name="account_type" rules={[{ required: true }]}>
                  <Select onChange={changeAccountType} options={[
                    { value: "CASH", label: "Tiền mặt" },
                    { value: "BANK", label: "Tiền gửi" }
                  ]} />
                </Form.Item>
                <Form.Item label="Quỹ / Tài khoản" name="fund_account_id"
                  rules={[{ required: true, message: "Chọn quỹ/tài khoản." }]}>
                  <Select
                    showSearch optionFilterProp="label"
                    options={accounts.filter((account) => account.type === accountType).map((account) => ({
                      value: account.id, label: account.name,
                      disabled: !account.is_active && account.id !== selected.fund_account_id
                    }))}
                  />
                </Form.Item>
              </div>
              <div className="supplier-form-grid">
                <Form.Item label="Ngày chứng từ" name="transaction_time"
                  rules={[{ required: true, message: "Chọn ngày chứng từ." }]}>
                  <Input type="datetime-local" />
                </Form.Item>
                <Form.Item label="Loại thu/chi" name="category_id"
                  rules={[{ required: true, message: "Chọn loại thu/chi." }]}>
                  <Select showSearch optionFilterProp="label"
                    options={availableCategories.map((category) => ({
                      value: category.id, label: category.name
                    }))}
                  />
                </Form.Item>
              </div>
              <Form.Item label="Số tiền (đ)" name="amount"
                rules={[{ required: true, message: "Nhập số tiền." }]}>
                <InputNumber<number>
                  min={1} step={1000} precision={0}
                  style={{ width: "100%" }} controls={false}
                  formatter={(value) => value == null ? "" : formatMoney(Number(value))}
                  parser={(value) => Number((value || "").replace(/\D/g, ""))}
                />
              </Form.Item>
              <Form.Item label="Diễn giải" name="description">
                <Input maxLength={500} />
              </Form.Item>
              <Form.Item label="Ghi chú" name="note">
                <TextArea rows={3} maxLength={1000} />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </>
  );
}
