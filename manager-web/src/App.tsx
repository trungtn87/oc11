import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Form,
  Input,
  Layout,
  Menu,
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
  createItemGroup,
  getItemGroups,
  updateItemGroup
} from "./api";
import type { ItemGroup, ItemGroupInput } from "./types";

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

type StatusFilter = "all" | "active" | "inactive";

type GroupForm = {
  name: string;
  note?: string;
  is_active: boolean;
};

function App() {
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ItemGroup | null>(null);
  const [form] = Form.useForm<GroupForm>();
  const [messageApi, messageContext] = message.useMessage();

  const loadGroups = async () => {
    try {
      setLoading(true);
      setGroups(await getItemGroups());
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được dữ liệu."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGroups();
  }, []);

  const filteredGroups = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");

    return groups.filter((group) => {
      const matchesSearch =
        !keyword ||
        group.name.toLocaleLowerCase("vi").includes(keyword) ||
        (group.note ?? "").toLocaleLowerCase("vi").includes(keyword);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && group.is_active) ||
        (statusFilter === "inactive" && !group.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [groups, search, statusFilter]);

  const openCreate = () => {
    setEditingGroup(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  };

  const openEdit = (group: ItemGroup) => {
    setEditingGroup(group);
    form.setFieldsValue({
      name: group.name,
      note: group.note ?? "",
      is_active: group.is_active
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingGroup(null);
    form.resetFields();
  };

  const saveGroup = async () => {
    const values = await form.validateFields();

    const payload: ItemGroupInput = {
      name: values.name.trim(),
      note: values.note?.trim() || null,
      is_active: values.is_active
    };

    try {
      setSaving(true);

      if (editingGroup) {
        await updateItemGroup(editingGroup.id, payload);
        messageApi.success("Đã cập nhật nhóm hàng hóa.");
      } else {
        await createItemGroup(payload);
        messageApi.success("Đã thêm nhóm hàng hóa.");
      }

      closeModal();
      await loadGroups();
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được dữ liệu."
      );
    } finally {
      setSaving(false);
    }
  };

  const columns: TableProps<ItemGroup>["columns"] = [
    {
      title: "Tên nhóm",
      dataIndex: "name",
      key: "name",
      width: "24%",
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: "Ghi chú",
      dataIndex: "note",
      key: "note",
      render: (note: string | null) => note || <Text type="secondary">—</Text>
    },
    {
      title: "Trạng thái",
      dataIndex: "is_active",
      key: "is_active",
      width: 170,
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
      width: 110,
      render: (_, group) => (
        <Button type="link" onClick={() => openEdit(group)}>
          Sửa
        </Button>
      )
    }
  ];

  return (
    <Layout className="app-shell">
      {messageContext}

      <Sider width={230} className="sidebar">
        <div className="brand">
          <div className="brand-title">Ốc 11</div>
          <div className="brand-subtitle">Manager</div>
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={["items"]}
          items={[
            { key: "dashboard", label: "Tổng quan" },
            { key: "items", label: "Hàng hóa" },
            { key: "inventory", label: "Kho" },
            { key: "purchases", label: "Nhập hàng" },
            { key: "cost", label: "Cost" },
            { key: "reports", label: "Báo cáo" },
            { key: "settings", label: "Cài đặt" }
          ]}
        />
      </Sider>

      <Layout>
        <Header className="topbar">
          <Text strong>Ốc 11 Manager</Text>
        </Header>

        <Content className="content">
          <div className="page-heading">
            <div>
              <Title level={2}>Nhóm hàng hóa</Title>
              <Text type="secondary">
                Quản lý nhóm nguyên vật liệu và hàng hóa.
              </Text>
            </div>

            <Button type="primary" size="large" onClick={openCreate}>
              + Thêm nhóm
            </Button>
          </div>

          <div className="toolbar">
            <Input.Search
              allowClear
              placeholder="Tìm kiếm nhóm hàng hóa..."
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
            <Table<ItemGroup>
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={filteredGroups}
              pagination={false}
              locale={{ emptyText: "Chưa có nhóm hàng hóa." }}
            />
          </div>
        </Content>
      </Layout>

      <Modal
        open={modalOpen}
        title={editingGroup ? "Sửa nhóm hàng hóa" : "Thêm nhóm hàng hóa"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        onCancel={closeModal}
        onOk={() => void saveGroup()}
      >
        <Form<GroupForm>
          form={form}
          layout="vertical"
          initialValues={{ is_active: true }}
          className="group-form"
        >
          <Form.Item
            label="Tên nhóm"
            name="name"
            rules={[
              { required: true, message: "Nhập tên nhóm hàng hóa." },
              { max: 100, message: "Tên nhóm tối đa 100 ký tự." }
            ]}
          >
            <Input placeholder="Ví dụ: Hải sản" autoFocus />
          </Form.Item>

          <Form.Item
            label="Ghi chú"
            name="note"
            rules={[{ max: 500, message: "Ghi chú tối đa 500 ký tự." }]}
          >
            <TextArea
              rows={4}
              placeholder="Ghi chú không bắt buộc..."
              showCount
              maxLength={500}
            />
          </Form.Item>

          <Form.Item
            label="Trạng thái"
            name="is_active"
            valuePropName="checked"
          >
            <Switch
              checkedChildren="Đang sử dụng"
              unCheckedChildren="Ngừng"
            />
          </Form.Item>
        </Form>

        {editingGroup && (
          <Space>
            <Text type="secondary">
              Nhóm hàng hóa không có chức năng xóa.
            </Text>
          </Space>
        )}
      </Modal>
    </Layout>
  );
}

export default App;
