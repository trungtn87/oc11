import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
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
  createRestaurantArea,
  createRestaurantTable,
  getInstalledPrinters,
  getPosSettings,
  getRestaurantAreas,
  getRestaurantTables,
  testKitchenPrinter,
  updatePosSettings,
  updateRestaurantArea,
  updateRestaurantTable
} from "./api";
import type {
  RestaurantArea,
  RestaurantAreaInput,
  RestaurantTable,
  RestaurantTableInput
} from "./types";

const { Title, Text } = Typography;

export function RestaurantTablesSettings() {
  const [areas, setAreas] = useState<RestaurantArea[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [areaOpen, setAreaOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [editingArea, setEditingArea] = useState<RestaurantArea | null>(null);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [areaForm] = Form.useForm<RestaurantAreaInput>();
  const [tableForm] = Form.useForm<RestaurantTableInput>();
  const [messageApi, contextHolder] = message.useMessage();

  async function load() {
    setLoading(true);
    try {
      const [areaRows, tableRows] = await Promise.all([
        getRestaurantAreas(),
        getRestaurantTables()
      ]);
      setAreas(areaRows);
      setTables(tableRows);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được danh sách bàn."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openArea(area?: RestaurantArea) {
    setEditingArea(area ?? null);
    areaForm.setFieldsValue(
      area
        ? {
            name: area.name,
            display_order: area.display_order,
            is_active: area.is_active
          }
        : {
            name: "",
            display_order: areas.length,
            is_active: true
          }
    );
    setAreaOpen(true);
  }

  async function saveArea() {
    const values = await areaForm.validateFields();
    try {
      if (editingArea) {
        await updateRestaurantArea(editingArea.id, values);
      } else {
        await createRestaurantArea(values);
      }
      messageApi.success("Đã lưu khu vực.");
      setAreaOpen(false);
      await load();
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được khu vực."
      );
    }
  }

  function openTable(row?: RestaurantTable) {
    setEditingTable(row ?? null);
    const defaultArea = areas.find((area) => area.is_active) ?? areas[0];
    tableForm.setFieldsValue(
      row
        ? {
            area_id: row.area_id,
            name: row.name,
            seats: row.seats,
            display_order: row.display_order,
            pos_x: row.pos_x,
            pos_y: row.pos_y,
            is_active: row.is_active
          }
        : {
            area_id: defaultArea?.id as number,
            name: "",
            seats: 4,
            display_order: tables.length,
            pos_x: 0,
            pos_y: 0,
            is_active: true
          }
    );
    setTableOpen(true);
  }

  async function saveTable() {
    const values = await tableForm.validateFields();
    try {
      if (editingTable) {
        await updateRestaurantTable(editingTable.id, values);
      } else {
        await createRestaurantTable(values);
      }
      messageApi.success("Đã lưu bàn.");
      setTableOpen(false);
      await load();
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được bàn."
      );
    }
  }

  const columns: TableProps<RestaurantTable>["columns"] = [
    { title: "Khu vực", dataIndex: "area_name", width: 150 },
    { title: "Tên bàn", dataIndex: "name", width: 120 },
    { title: "Số ghế", dataIndex: "seats", width: 90, align: "right" },
    { title: "Thứ tự", dataIndex: "display_order", width: 90, align: "right" },
    {
      title: "Trạng thái",
      key: "status",
      width: 140,
      render: (_, row) =>
        row.open_order_id ? (
          <Tag color="orange">Đang phục vụ</Tag>
        ) : row.is_active ? (
          <Tag color="green">Hoạt động</Tag>
        ) : (
          <Tag>Ngừng dùng</Tag>
        )
    },
    {
      title: "",
      key: "actions",
      width: 90,
      render: (_, row) => (
        <Button size="small" onClick={() => openTable(row)}>
          Sửa
        </Button>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      <div className="page-heading">
        <div>
          <Title level={3}>Khu vực & bàn</Title>
          <Text type="secondary">
            Quản lý khu vực và bàn dùng chung cho sơ đồ POS. Không xóa vật lý; bàn cũ chuyển sang ngừng sử dụng.
          </Text>
        </div>
      </div>

      <Card
        title="Khu vực"
        extra={
          <Button type="primary" onClick={() => openArea()}>
            + Khu vực
          </Button>
        }
        style={{ marginBottom: 14 }}
      >
        <Space wrap>
          {areas.map((area) => (
            <Button key={area.id} onClick={() => openArea(area)}>
              {area.name} {!area.is_active ? "(ngừng dùng)" : ""}
            </Button>
          ))}
          {!areas.length && <Text type="secondary">Chưa có khu vực.</Text>}
        </Space>
      </Card>

      <Card
        title="Danh sách bàn"
        extra={
          <Button
            type="primary"
            disabled={!areas.length}
            onClick={() => openTable()}
          >
            + Bàn
          </Button>
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={tables}
          pagination={false}
          size="small"
        />
      </Card>

      <Modal
        open={areaOpen}
        title={editingArea ? "Sửa khu vực" : "Thêm khu vực"}
        okText="Lưu"
        cancelText="Hủy"
        onOk={() => void saveArea()}
        onCancel={() => setAreaOpen(false)}
      >
        <Form form={areaForm} layout="vertical">
          <Form.Item
            name="name"
            label="Tên khu vực"
            rules={[{ required: true, message: "Nhập tên khu vực." }]}
          >
            <Input autoFocus placeholder="VD: Tầng 1, Sân" />
          </Form.Item>
          <Form.Item name="display_order" label="Thứ tự">
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="is_active" label="Đang sử dụng" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={tableOpen}
        title={editingTable ? "Sửa bàn" : "Thêm bàn"}
        okText="Lưu"
        cancelText="Hủy"
        onOk={() => void saveTable()}
        onCancel={() => setTableOpen(false)}
      >
        <Form form={tableForm} layout="vertical">
          <Form.Item
            name="area_id"
            label="Khu vực"
            rules={[{ required: true, message: "Chọn khu vực." }]}
          >
            <Select
              options={areas.map((area) => ({
                value: area.id,
                label: area.name,
                disabled: !area.is_active
              }))}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="Tên / số bàn"
            rules={[{ required: true, message: "Nhập tên bàn." }]}
          >
            <Input autoFocus placeholder="VD: 1, A1" />
          </Form.Item>
          <Space style={{ width: "100%" }} align="start">
            <Form.Item name="seats" label="Số ghế">
              <InputNumber min={0} />
            </Form.Item>
            <Form.Item name="display_order" label="Thứ tự">
              <InputNumber />
            </Form.Item>
          </Space>
          <Text type="secondary">
            X/Y dành cho sơ đồ bàn tùy chỉnh về sau. POS hiện xếp bàn theo thứ tự.
          </Text>
          <Space style={{ width: "100%", marginTop: 10 }} align="start">
            <Form.Item name="pos_x" label="Vị trí X">
              <InputNumber />
            </Form.Item>
            <Form.Item name="pos_y" label="Vị trí Y">
              <InputNumber />
            </Form.Item>
          </Space>
          <Form.Item name="is_active" label="Đang sử dụng" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export function KitchenPrinterSettings() {
  const [printers, setPrinters] = useState<string[]>([]);
  const [printerName, setPrinterName] = useState("");
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [settings, printerRows] = await Promise.all([
          getPosSettings(),
          getInstalledPrinters()
        ]);
        if (cancelled) return;
        setPrinterName(settings.kitchen_printer_name);
        setPrinters(printerRows);
      } catch (error) {
        if (!cancelled) {
          messageApi.error(
            error instanceof Error ? error.message : "Không tải được cài đặt máy in."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const printerOptions = useMemo(() => {
    const names = [...printers];
    if (printerName && !names.includes(printerName)) names.unshift(printerName);
    return names.map((name) => ({ value: name, label: name }));
  }, [printers, printerName]);

  async function save() {
    try {
      await updatePosSettings({ kitchen_printer_name: printerName.trim() });
      messageApi.success("Đã lưu máy in bếp.");
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được máy in."
      );
    }
  }

  async function test() {
    setTesting(true);
    try {
      await updatePosSettings({ kitchen_printer_name: printerName.trim() });
      const result = await testKitchenPrinter();
      if (result.ok) {
        messageApi.success("Đã gửi phiếu test tới máy in bếp.");
      } else {
        messageApi.error(result.error || "Không in được phiếu test.");
      }
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không test được máy in."
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      {contextHolder}
      <Card loading={loading} title="Máy in bếp">
        <div style={{ maxWidth: 560 }}>
          <Text type="secondary">
            Nút “Gửi bếp” trên POS sẽ in bill món trực tiếp ra máy in Windows đã chọn.
          </Text>
          <div style={{ marginTop: 14 }}>
            <Select
              showSearch
              allowClear
              value={printerName || undefined}
              onChange={(value) => setPrinterName(value ?? "")}
              placeholder="Chọn máy in bếp"
              options={printerOptions}
              style={{ width: "100%" }}
            />
            <Input
              value={printerName}
              onChange={(event) => setPrinterName(event.target.value)}
              placeholder="Hoặc nhập chính xác tên máy in Windows"
              style={{ marginTop: 8 }}
            />
          </div>
          <Space style={{ marginTop: 14 }}>
            <Button type="primary" onClick={() => void save()}>
              Lưu
            </Button>
            <Button loading={testing} onClick={() => void test()}>
              In thử
            </Button>
          </Space>
        </div>
      </Card>
    </>
  );
}
