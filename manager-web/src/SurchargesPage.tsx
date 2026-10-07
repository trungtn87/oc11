import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Space,
  Table,
  Typography
} from "antd";
import type { TableProps } from "antd";

import {
  createSurchargePreset,
  deleteSurchargePreset,
  getSurchargePresets,
  updateSurchargePreset
} from "./api";
import type { SurchargePreset, SurchargePresetInput } from "./types";

const { Title, Text } = Typography;

type FormValues = {
  name: string;
  amount: number;
};

function money(value: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(value));
}

export default function SurchargesPage() {
  const [items, setItems] = useState<SurchargePreset[]>([]);
  const [editing, setEditing] = useState<SurchargePreset | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [messageApi, messageContext] = message.useMessage();

  const load = async () => {
    try {
      setLoading(true);
      setItems(await getSurchargePresets());
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được danh sách phụ thu."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ name: "", amount: 0 });
    setOpen(true);
  };

  const openEdit = (item: SurchargePreset) => {
    setEditing(item);
    form.setFieldsValue({ name: item.name, amount: item.amount });
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      const payload: SurchargePresetInput = {
        name: values.name.trim(),
        amount: Math.round(Number(values.amount || 0))
      };
      setSaving(true);
      if (editing) {
        await updateSurchargePreset(editing.id, payload);
        messageApi.success("Đã sửa phụ thu.");
      } else {
        await createSurchargePreset(payload);
        messageApi.success("Đã thêm phụ thu.");
      }
      setOpen(false);
      await load();
    } catch (error) {
      if (error instanceof Error) {
        messageApi.error(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = (item: SurchargePreset) => {
    Modal.confirm({
      title: "Xóa phụ thu?",
      content: `Xóa "${item.name}" khỏi danh sách dùng nhanh. Các hóa đơn cũ vẫn giữ nguyên dữ liệu phụ thu.`,
      okText: "Xóa",
      okButtonProps: { danger: true },
      cancelText: "Hủy",
      onOk: async () => {
        try {
          await deleteSurchargePreset(item.id);
          messageApi.success("Đã xóa phụ thu.");
          await load();
        } catch (error) {
          messageApi.error(
            error instanceof Error ? error.message : "Không xóa được phụ thu."
          );
        }
      }
    });
  };

  const columns: TableProps<SurchargePreset>["columns"] = [
    {
      title: "Tên phụ thu",
      dataIndex: "name",
      key: "name",
      render: (name: string) => <Text strong>{name}</Text>
    },
    {
      title: "Số tiền mặc định",
      dataIndex: "amount",
      key: "amount",
      width: 180,
      align: "right",
      render: (value: number) => `${money(value)} đ`
    },
    {
      title: "",
      key: "actions",
      width: 150,
      align: "right",
      render: (_, item) => (
        <Space>
          <Button size="small" onClick={() => openEdit(item)}>Sửa</Button>
          <Button size="small" danger onClick={() => remove(item)}>Xóa</Button>
        </Space>
      )
    }
  ];

  return (
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Phụ thu</Title>
          <Text type="secondary">
            Danh sách phụ thu dùng nhanh khi bán hàng. Phụ thu mới tạo lúc bán sẽ tự lưu ở đây.
          </Text>
        </div>
        <Button type="primary" onClick={openCreate}>+ Thêm phụ thu</Button>
      </div>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={items}
          columns={columns}
          pagination={false}
          size="small"
        />
      </Card>

      <Modal
        open={open}
        title={editing ? "Sửa phụ thu" : "Thêm phụ thu"}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
      >
        <Form<FormValues> form={form} layout="vertical">
          <Form.Item
            label="Tên phụ thu"
            name="name"
            rules={[{ required: true, whitespace: true, message: "Nhập tên phụ thu." }]}
          >
            <Input maxLength={120} autoFocus placeholder="VD: Thêm sốt" />
          </Form.Item>
          <Form.Item
            label="Số tiền mặc định"
            name="amount"
            rules={[
              {
                validator: (_, value) =>
                  Number(value) > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error("Số tiền phải lớn hơn 0."))
              }
            ]}
          >
            <InputNumber<number>
              min={1}
              precision={0}
              style={{ width: "100%" }}
              formatter={(value) =>
                value === undefined || value === null ? "" : money(Number(value))
              }
              parser={(value) => Number((value ?? "").replace(/[^0-9]/g, ""))}
              addonAfter="đ"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
