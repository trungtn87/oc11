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
  Switch,
  Table,
  Tag,
  Typography
} from "antd";
import type { TableProps } from "antd";

import {
  createFundTransactionCategory,
  getFundTransactionCategories,
  updateFundTransactionCategory
} from "./api";
import type {
  FundTransactionCategory,
  FundTransactionCategoryInput
} from "./types";

const { Title, Text } = Typography;

type CategoryForm = {
  name: string;
  direction: "IN" | "OUT";
  is_active: boolean;
  sort_order: number;
};

export default function FundTransactionCategoriesPage() {
  const [items, setItems] = useState<FundTransactionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [editing, setEditing] = useState<FundTransactionCategory | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CategoryForm>();
  const [messageApi, messageContext] = message.useMessage();

  const load = async () => {
    try {
      setLoading(true);
      setItems(await getFundTransactionCategories());
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được loại thu/chi."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const data = useMemo(
    () =>
      filter === "ALL"
        ? items
        : items.filter((item) => item.direction === filter),
    [items, filter]
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      direction: filter === "ALL" ? "OUT" : filter,
      is_active: true,
      sort_order: 0
    });
    setOpen(true);
  };

  const openEdit = (item: FundTransactionCategory) => {
    setEditing(item);
    form.setFieldsValue({
      name: item.name,
      direction: item.direction,
      is_active: item.is_active,
      sort_order: item.sort_order
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      const payload: FundTransactionCategoryInput = {
        name: values.name.trim(),
        direction: values.direction,
        is_active: values.is_active,
        sort_order: values.sort_order ?? 0
      };

      setSaving(true);
      if (editing) {
        await updateFundTransactionCategory(editing.id, payload);
      } else {
        await createFundTransactionCategory(payload);
      }
      setOpen(false);
      form.resetFields();
      await load();
      messageApi.success(editing ? "Đã cập nhật loại thu/chi." : "Đã thêm loại thu/chi.");
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const columns: TableProps<FundTransactionCategory>["columns"] = [
    {
      title: "Tên loại",
      dataIndex: "name",
      key: "name",
      render: (value: string) => <Text strong>{value}</Text>
    },
    {
      title: "Loại",
      dataIndex: "direction",
      key: "direction",
      width: 130,
      render: (value: "IN" | "OUT") =>
        value === "IN" ? <Tag color="green">Thu</Tag> : <Tag color="red">Chi</Tag>
    },
    {
      title: "Trạng thái",
      dataIndex: "is_active",
      key: "is_active",
      width: 150,
      render: (value: boolean) =>
        value ? <Tag color="success">Đang sử dụng</Tag> : <Tag>Ngừng sử dụng</Tag>
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Loại thu/chi</Title>
          <Text type="secondary">
            Dùng để phân loại khoản thu, chi phục vụ kiểm tra và báo cáo.
          </Text>
        </div>

        <Button type="primary" size="large" onClick={openCreate}>
          + Thêm loại
        </Button>
      </div>

      <div className="toolbar">
        <Space>
          <Text type="secondary">Hiển thị</Text>
          <Select
            value={filter}
            style={{ width: 170 }}
            onChange={setFilter}
            options={[
              { value: "ALL", label: "Tất cả" },
              { value: "OUT", label: "Loại chi" },
              { value: "IN", label: "Loại thu" }
            ]}
          />
        </Space>
      </div>

      <div className="table-card">
        <Table<FundTransactionCategory>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data}
          pagination={false}
          locale={{ emptyText: "Chưa có loại thu/chi." }}
          onRow={(item) => ({
            onClick: () => openEdit(item),
            className: "supplier-row"
          })}
        />
      </div>

      <Modal
        open={open}
        width={520}
        title={editing ? "Sửa loại thu/chi" : "Thêm loại thu/chi"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
      >
        <Form<CategoryForm> form={form} layout="vertical">
          <Form.Item
            label="Tên loại"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "Nhập tên loại thu/chi." }
            ]}
          >
            <Input placeholder="Ví dụ: Điện nước, Vật tư tiêu hao..." autoFocus />
          </Form.Item>

          <Form.Item
            label="Thu / Chi"
            name="direction"
            rules={[{ required: true }]}
          >
            <Select
              disabled={Boolean(editing && !editing.can_change_direction)}
              options={[
                { value: "OUT", label: "Chi" },
                { value: "IN", label: "Thu" }
              ]}
            />
          </Form.Item>

          {editing && !editing.can_change_direction && (
            <Text type="secondary">
              Loại này đã phát sinh giao dịch nên không thể đổi từ Thu sang Chi hoặc ngược lại.
            </Text>
          )}

          <Form.Item label="Thứ tự hiển thị" name="sort_order">
            <InputNumber min={0} precision={0} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
            <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
