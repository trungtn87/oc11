import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { TableProps } from "antd";

import {
  createMenuGroup,
  getMenuGroups,
  updateMenuGroup
} from "./api";
import type { MenuGroup, MenuGroupInput } from "./types";

const { Title, Text } = Typography;
const { TextArea } = Input;

type StatusFilter = "all" | "active" | "inactive";

type MenuGroupForm = {
  name: string;
  display_order: number;
  is_active: boolean;
  note?: string;
};

export default function MenuGroupsPage() {
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MenuGroup | null>(null);
  const [form] = Form.useForm<MenuGroupForm>();
  const [messageApi, messageContext] = message.useMessage();

  const load = async () => {
    try {
      setLoading(true);
      setGroups(await getMenuGroups());
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được nhóm thực đơn."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");
    return groups.filter((group) => {
      const matchSearch =
        !keyword ||
        group.name.toLocaleLowerCase("vi").includes(keyword) ||
        (group.note ?? "").toLocaleLowerCase("vi").includes(keyword);
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && group.is_active) ||
        (statusFilter === "inactive" && !group.is_active);
      return matchSearch && matchStatus;
    });
  }, [groups, search, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      display_order: groups.length + 1,
      is_active: true
    });
    setModalOpen(true);
  };

  const openEdit = (group: MenuGroup) => {
    setEditing(group);
    form.setFieldsValue({
      name: group.name,
      display_order: group.display_order,
      is_active: group.is_active,
      note: group.note ?? undefined
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      const payload: MenuGroupInput = {
        name: values.name.trim(),
        display_order: values.display_order ?? 0,
        is_active: values.is_active,
        note: values.note?.trim() || null
      };
      setSaving(true);
      if (editing) {
        await updateMenuGroup(editing.id, payload);
        messageApi.success("Đã cập nhật nhóm thực đơn.");
      } else {
        await createMenuGroup(payload);
        messageApi.success("Đã thêm nhóm thực đơn.");
      }
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      await load();
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const columns: TableProps<MenuGroup>["columns"] = [
    {
      title: "Tên nhóm",
      dataIndex: "name",
      key: "name",
      render: (value: string) => <Text strong>{value}</Text>
    },
    {
      title: "Thứ tự",
      dataIndex: "display_order",
      key: "display_order",
      width: 100
    },
    {
      title: "Ghi chú",
      dataIndex: "note",
      key: "note",
      render: (value: string | null) =>
        value || <Text type="secondary">—</Text>
    },
    {
      title: "Trạng thái",
      dataIndex: "is_active",
      key: "is_active",
      width: 150,
      render: (value: boolean) =>
        value ? (
          <Tag color="success">Đang sử dụng</Tag>
        ) : (
          <Tag>Ngừng sử dụng</Tag>
        )
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

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Nhóm thực đơn</Title>
          <Text type="secondary">
            Nhóm hiển thị món bán; không xóa nhóm đã tạo, chỉ ngừng sử dụng.
          </Text>
        </div>
        <Button type="primary" size="large" onClick={openCreate}>
          + Thêm nhóm
        </Button>
      </div>

      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="Tìm nhóm thực đơn..."
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
        <Table<MenuGroup>
          rowKey="id"
          loading={loading}
          dataSource={filtered}
          columns={columns}
          pagination={false}
          locale={{ emptyText: "Chưa có nhóm thực đơn." }}
        />
      </div>

      <Modal
        open={modalOpen}
        title={editing ? "Sửa nhóm thực đơn" : "Thêm nhóm thực đơn"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={() => void save()}
      >
        <Form<MenuGroupForm>
          form={form}
          layout="vertical"
          initialValues={{ display_order: 0, is_active: true }}
        >
          <Form.Item
            label="Tên nhóm"
            name="name"
            rules={[
              {
                required: true,
                whitespace: true,
                message: "Nhập tên nhóm thực đơn."
              }
            ]}
          >
            <Input autoFocus placeholder="Ví dụ: Ốc hương, Tôm, Mực..." />
          </Form.Item>

          <div className="menu-group-form-grid">
            <Form.Item label="Thứ tự" name="display_order">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
              <Switch checkedChildren="Đang dùng" unCheckedChildren="Ngừng" />
            </Form.Item>
          </div>

          <Form.Item label="Ghi chú" name="note">
            <TextArea rows={3} placeholder="Không bắt buộc..." />
          </Form.Item>
        </Form>

        {editing && (
          <Space>
            <Text type="secondary">
              Nhóm thực đơn không có chức năng xóa.
            </Text>
          </Space>
        )}
      </Modal>
    </>
  );
}
