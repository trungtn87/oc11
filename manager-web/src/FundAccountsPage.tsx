import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography
} from "antd";
import type { TableProps } from "antd";

import {
  createFundAccount,
  deleteFundAccount,
  getFundAccounts,
  updateFundAccount
} from "./api";
import type {
  FundAccount,
  FundAccountInput
} from "./types";

const { Title, Text } = Typography;
const { TextArea } = Input;

type StatusFilter = "all" | "active" | "inactive";
type FundMode = "create" | "view" | "edit";

type FundForm = {
  name: string;
  bank_name?: string;
  account_number?: string;
  account_name?: string;
  note?: string;
  is_active: boolean;
  is_default: boolean;
};

function cleanOptional(value?: string | null) {
  const cleaned = value?.trim() ?? "";
  return cleaned || null;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + " đ";
}

export function CashFundsPage() {
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<FundMode>("view");
  const [selected, setSelected] = useState<FundAccount | null>(null);
  const [form] = Form.useForm<FundForm>();
  const [messageApi, messageContext] = message.useMessage();

  const loadAccounts = async () => {
    try {
      setLoading(true);
      setAccounts(await getFundAccounts("CASH"));
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được quỹ tiền mặt."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");
    if (!keyword) return accounts;
    return accounts.filter((item) =>
      item.name.toLocaleLowerCase("vi").includes(keyword)
    );
  }, [accounts, search]);

  const setFormFromAccount = (account: FundAccount) => {
    form.setFieldsValue({
      name: account.name,
      note: account.note ?? undefined,
      is_active: account.is_active,
      is_default: account.is_default
    });
  };

  const openCreate = () => {
    setSelected(null);
    setMode("create");
    form.resetFields();
    form.setFieldsValue({ is_active: true, is_default: false });
    setModalOpen(true);
  };

  const openView = (account: FundAccount) => {
    setSelected(account);
    setMode("view");
    setFormFromAccount(account);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelected(null);
    form.resetFields();
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const payload: FundAccountInput = {
        name: values.name.trim(),
        type: "CASH",
        bank_name: null,
        account_number: null,
        account_name: null,
        note: cleanOptional(values.note),
        is_active: values.is_active,
        is_default: values.is_default
      };

      const saved =
        mode === "edit" && selected
          ? await updateFundAccount(selected.id, payload)
          : await createFundAccount(payload);

      await loadAccounts();
      setSelected(saved);
      setMode("view");
      setFormFromAccount(saved);
      messageApi.success(
        mode === "edit" ? "Đã cập nhật quỹ." : "Đã thêm quỹ."
      );
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!selected || !selected.can_delete) return;

    Modal.confirm({
      title: "Xóa quỹ?",
      content: `Quỹ "${selected.name}" sẽ bị xóa khỏi danh sách.`,
      okText: "Xóa",
      cancelText: "Hủy",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteFundAccount(selected.id);
          closeModal();
          await loadAccounts();
          messageApi.success("Đã xóa quỹ.");
        } catch (error) {
          messageApi.error(
            error instanceof Error ? error.message : "Không xóa được quỹ."
          );
        }
      }
    });
  };

  const columns: TableProps<FundAccount>["columns"] = [
    {
      title: "Tên quỹ",
      dataIndex: "name",
      key: "name",
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: "Mặc định",
      dataIndex: "is_default",
      key: "is_default",
      width: 120,
      render: (value: boolean) =>
        value ? <Tag color="blue">Mặc định</Tag> : <Text type="secondary">—</Text>
    },
    {
      title: "Số dư hiện tại",
      dataIndex: "current_balance",
      key: "current_balance",
      width: 200,
      align: "right",
      render: (value: number) => <Text strong>{formatMoney(value)}</Text>
    }
  ];

  const modalTitle =
    mode === "create"
      ? "Thêm quỹ tiền mặt"
      : mode === "edit"
        ? "Sửa quỹ tiền mặt"
        : "Thông tin quỹ tiền mặt";

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Quỹ tiền mặt</Title>
          <Text type="secondary">
            Quản lý các quỹ tiền mặt như Quỹ quán, Quỹ đi chợ.
          </Text>
        </div>
        <Button type="primary" size="large" onClick={openCreate}>
          + Thêm quỹ
        </Button>
      </div>

      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="Tìm theo tên quỹ..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="search-box"
        />
      </div>

      <div className="table-card">
        <Table<FundAccount>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={false}
          locale={{ emptyText: "Chưa có quỹ tiền mặt." }}
          onRow={(account) => ({
            onClick: () => openView(account),
            className: "supplier-row"
          })}
        />
      </div>

      <Modal
        open={modalOpen}
        width={600}
        title={modalTitle}
        onCancel={closeModal}
        footer={
          mode === "view" ? (
            <div className="supplier-modal-footer">
              <div>
                {selected && (
                  <Button
                    danger
                    disabled={!selected.can_delete}
                    onClick={confirmDelete}
                  >
                    Xóa
                  </Button>
                )}
              </div>
              <Space>
                <Button onClick={closeModal}>Đóng</Button>
                <Button type="primary" onClick={() => setMode("edit")}>
                  Sửa
                </Button>
              </Space>
            </div>
          ) : (
            <Space>
              <Button
                onClick={() => {
                  if (selected) openView(selected);
                  else closeModal();
                }}
              >
                Hủy
              </Button>
              <Button
                type="primary"
                loading={saving}
                onClick={() => void save()}
              >
                Lưu
              </Button>
            </Space>
          )
        }
      >
        <Form<FundForm>
          form={form}
          layout="vertical"
          disabled={mode === "view"}
          initialValues={{ is_active: true, is_default: false }}
          className="supplier-form"
        >
          <Form.Item
            label="Tên quỹ"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "Nhập tên quỹ." },
              { max: 100, message: "Tên quỹ tối đa 100 ký tự." }
            ]}
          >
            <Input
              placeholder="Ví dụ: Quỹ quán, Quỹ đi chợ"
              autoFocus={mode === "create"}
            />
          </Form.Item>

          {mode === "view" && selected && (
            <Form.Item label="Số dư hiện tại">
              <Input value={formatMoney(selected.current_balance)} disabled />
            </Form.Item>
          )}

          <Form.Item label="Ghi chú" name="note">
            <TextArea rows={3} placeholder="Ghi chú không bắt buộc..." />
          </Form.Item>

          <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
            <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng" />
          </Form.Item>

          <Form.Item
            label="Quỹ tiền mặt mặc định"
            name="is_default"
            valuePropName="checked"
            extra={
              selected?.is_default
                ? "Muốn đổi mặc định, mở một quỹ khác và bật mục này."
                : "Phiếu thu/chi và nhập hàng sẽ ưu tiên quỹ này."
            }
          >
            <Switch
              checkedChildren="Mặc định"
              unCheckedChildren="Không"
              disabled={Boolean(selected?.is_default)}
            />
          </Form.Item>
        </Form>

        {mode === "view" && selected && !selected.can_delete && (
          <Text type="secondary" className="supplier-delete-note">
            Không thể xóa vì quỹ đã có giao dịch phát sinh.
          </Text>
        )}
      </Modal>
    </>
  );
}

export function BankAccountsPage() {
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FundAccount | null>(null);
  const [form] = Form.useForm<FundForm>();
  const [messageApi, messageContext] = message.useMessage();

  const loadAccounts = async () => {
    try {
      setLoading(true);
      setAccounts(await getFundAccounts("BANK"));
    } catch (error) {
      messageApi.error(
        error instanceof Error
          ? error.message
          : "Không tải được tài khoản ngân hàng."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");

    return accounts.filter((account) => {
      const searchText = [
        account.name,
        account.bank_name ?? "",
        account.account_number ?? "",
        account.account_name ?? ""
      ]
        .join(" ")
        .toLocaleLowerCase("vi");

      const matchesSearch = !keyword || searchText.includes(keyword);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && account.is_active) ||
        (statusFilter === "inactive" && !account.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [accounts, search, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  };

  const openEdit = (account: FundAccount) => {
    setEditing(account);
    form.setFieldsValue({
      name: account.name,
      bank_name: account.bank_name ?? undefined,
      account_number: account.account_number ?? undefined,
      account_name: account.account_name ?? undefined,
      note: account.note ?? undefined,
      is_active: account.is_active,
      is_default: account.is_default
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const payload: FundAccountInput = {
        name: values.name.trim(),
        type: "BANK",
        bank_name: cleanOptional(values.bank_name),
        account_number: cleanOptional(values.account_number),
        account_name: cleanOptional(values.account_name),
        note: cleanOptional(values.note),
        is_active: values.is_active,
        is_default: values.is_default
      };

      if (editing) {
        await updateFundAccount(editing.id, payload);
        messageApi.success("Đã cập nhật tài khoản ngân hàng.");
      } else {
        await createFundAccount(payload);
        messageApi.success("Đã thêm tài khoản ngân hàng.");
      }

      closeModal();
      await loadAccounts();
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const columns: TableProps<FundAccount>["columns"] = [
    {
      title: "Tên tài khoản",
      dataIndex: "name",
      key: "name",
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: "Ngân hàng",
      dataIndex: "bank_name",
      key: "bank_name",
      render: (value: string | null) => value || <Text type="secondary">—</Text>
    },
    {
      title: "Số tài khoản",
      dataIndex: "account_number",
      key: "account_number",
      render: (value: string | null) => value || <Text type="secondary">—</Text>
    },
    {
      title: "Chủ tài khoản",
      dataIndex: "account_name",
      key: "account_name",
      render: (value: string | null) => value || <Text type="secondary">—</Text>
    },
    {
      title: "Mặc định",
      dataIndex: "is_default",
      key: "is_default",
      width: 120,
      render: (value: boolean) =>
        value ? <Tag color="blue">Mặc định</Tag> : <Text type="secondary">—</Text>
    },
    {
      title: "Trạng thái",
      dataIndex: "is_active",
      key: "is_active",
      width: 160,
      render: (isActive: boolean) =>
        isActive ? (
          <Tag color="success">Đang sử dụng</Tag>
        ) : (
          <Tag>Ngừng sử dụng</Tag>
        )
    },
    {
      title: "Thao tác",
      key: "action",
      width: 100,
      render: (_, account) => (
        <Button type="link" onClick={() => openEdit(account)}>
          Sửa
        </Button>
      )
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Tài khoản ngân hàng</Title>
          <Text type="secondary">
            Quản lý các tài khoản nhận và chi tiền chuyển khoản.
          </Text>
        </div>
        <Button type="primary" size="large" onClick={openCreate}>
          + Thêm tài khoản
        </Button>
      </div>

      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="Tìm tài khoản ngân hàng..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="search-box"
        />

        <Select<StatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          className="status-filter"
          options={[
            { value: "all", label: "Tất cả trạng thái" },
            { value: "active", label: "Đang sử dụng" },
            { value: "inactive", label: "Ngừng sử dụng" }
          ]}
        />
      </div>

      <div className="table-card">
        <Table<FundAccount>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={false}
          locale={{ emptyText: "Chưa có tài khoản ngân hàng." }}
        />
      </div>

      <Modal
        open={modalOpen}
        title={editing ? "Sửa tài khoản ngân hàng" : "Thêm tài khoản ngân hàng"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        onCancel={closeModal}
        onOk={() => void save()}
      >
        <Form<FundForm>
          form={form}
          layout="vertical"
          initialValues={{ is_active: true, is_default: false }}
          className="group-form"
        >
          <Form.Item
            label="Tên tài khoản"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "Nhập tên tài khoản." },
              { max: 100, message: "Tên tài khoản tối đa 100 ký tự." }
            ]}
          >
            <Input placeholder="Ví dụ: MB Bank quán" autoFocus />
          </Form.Item>

          <Form.Item label="Ngân hàng" name="bank_name">
            <Input placeholder="Ví dụ: MB Bank" />
          </Form.Item>

          <Form.Item label="Số tài khoản" name="account_number">
            <Input placeholder="Số tài khoản" />
          </Form.Item>

          <Form.Item label="Tên chủ tài khoản" name="account_name">
            <Input placeholder="Tên chủ tài khoản" />
          </Form.Item>

          <Form.Item label="Ghi chú" name="note">
            <TextArea rows={3} placeholder="Ghi chú không bắt buộc..." />
          </Form.Item>

          <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
            <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng" />
          </Form.Item>

          <Form.Item
            label="Tài khoản ngân hàng mặc định"
            name="is_default"
            valuePropName="checked"
            extra={
              editing?.is_default
                ? "Muốn đổi mặc định, mở một tài khoản khác và bật mục này."
                : "Các phiếu tiền gửi/chuyển khoản sẽ ưu tiên tài khoản này."
            }
          >
            <Switch
              checkedChildren="Mặc định"
              unCheckedChildren="Không"
              disabled={Boolean(editing?.is_default)}
            />
          </Form.Item>
        </Form>

        {editing && (
          <Space>
            <Text type="secondary">
              Tài khoản ngân hàng không có chức năng xóa.
            </Text>
          </Space>
        )}
      </Modal>
    </>
  );
}
