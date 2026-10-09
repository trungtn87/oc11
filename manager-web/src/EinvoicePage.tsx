import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import {
  getEinvoiceOrders, getEinvoicePreview, getEinvoiceSettings, requestEinvoice,
  updateEinvoiceSettings
} from "./api";
import type { EinvoiceOrder, EinvoicePreview, EinvoiceSettings } from "./api";

const { Title, Text } = Typography;

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + " đ";
}

function invoiceLabel(value: string) {
  if (value === "DRAFT") return "Chờ phát hành";
  if (value === "ISSUED") return "Đã phát hành";
  if (value === "NOT_REQUESTED") return "Chưa yêu cầu";
  if (value === "CANCELLED") return "Đã hủy";
  return value;
}

export function EinvoiceRequestsPage() {
  const [rows, setRows] = useState<EinvoiceOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<EinvoicePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  async function load() {
    setBusy(true);
    try {
      setRows(await getEinvoiceOrders());
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không tải được danh sách HĐĐT.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function openPreview(id: number) {
    setPreviewBusy(true);
    try {
      setPreview(await getEinvoicePreview(id));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không xem được đơn.");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function request(id: number) {
    try {
      await requestEinvoice(id);
      messageApi.success("Đã tạo yêu cầu HĐĐT. Chưa gửi MISA.");
      await load();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không tạo được yêu cầu.");
    }
  }

  return <>
    {contextHolder}
    <div className="page-heading"><Title level={3}>Hóa đơn điện tử</Title></div>
    <Alert type="warning" showIcon style={{ marginBottom: 16 }}
      message="CUKCUK vẫn là hệ thống phát hành hóa đơn thật"
      description="POS Ốc 11 chỉ lập yêu cầu và kiểm tra dữ liệu. Không có thao tác phát hành MISA trong giai đoạn này. Đối chiếu hóa đơn đã phát hành trên CUKCUK để tránh xuất trùng."
    />
    <Card>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => void load()} loading={busy}>Làm mới</Button>
        <Text type="secondary">Hiển thị tối đa 500 đơn đã chốt gần nhất.</Text>
      </Space>
      <Table<EinvoiceOrder> rowKey="sales_order_id" dataSource={rows} loading={busy}
        size="middle" scroll={{ x: 850 }} pagination={{ pageSize: 15 }}
        columns={[
          { title: "Đơn bán", dataIndex: "order_code", width: 155 },
          { title: "Thời gian", dataIndex: "order_time", width: 165,
            render: (value: string) => value.slice(0, 16).replace("T", " ") },
          { title: "Khách hàng", dataIndex: "customer_name",
            render: (value: string | null) => value || "Chưa chọn" },
          { title: "Số tiền", dataIndex: "total_amount", align: "right", width: 140,
            render: (value: number) => formatMoney(value) },
          { title: "HĐĐT", dataIndex: "invoice_status", width: 150,
            render: (value: string) => <Tag color={value === "ISSUED" ? "green" : "default"}>{invoiceLabel(value)}</Tag> },
          { title: "Thao tác", key: "actions", width: 240,
            render: (_, row) => <Space>
              <Button onClick={() => void openPreview(row.sales_order_id)} loading={previewBusy}>Xem dữ liệu</Button>
              <Button type="primary"
                disabled={row.invoice_status !== "NOT_REQUESTED" || !row.customer_name}
                onClick={() => Modal.confirm({
                  title: "Tạo yêu cầu HĐĐT?",
                  content: "Chức năng này chỉ lưu bản nháp trên POS Ốc 11; chưa gửi MISA.",
                  okText: "Tạo yêu cầu",
                  cancelText: "Đóng",
                  onOk: async () => { await request(row.sales_order_id); }
                })}
              >Tạo yêu cầu</Button>
            </Space> }
        ]}
      />
    </Card>
    <Modal open={!!preview} title={preview ? "Kiểm tra dữ liệu · " + preview.order_code : ""}
      onCancel={() => setPreview(null)} footer={<Button onClick={() => setPreview(null)}>Đóng</Button>}
      width={750}>
      {preview && <>
        <p><b>Khách hàng:</b> {preview.customer.name || "Chưa chọn"} · MST: {preview.customer.tax_code || "—"}</p>
        <p><b>Địa chỉ:</b> {preview.customer.address || "—"}</p>
        <Table size="small" rowKey="id" pagination={false} dataSource={preview.items}
          columns={[
            { title: "Món", key: "name", render: (_, row) =>
              row.item_name_snapshot + (row.option_name_snapshot ? " · " + row.option_name_snapshot : "") },
            { title: "SL", dataIndex: "quantity", width: 55 },
            { title: "Đơn giá", dataIndex: "unit_price", align: "right", render: formatMoney },
            { title: "Thành tiền", key: "total", align: "right",
              render: (_, row) => formatMoney(row.line_total + row.surcharge_total) }
          ]}/>
        {preview.order_surcharges.length > 0 && <p>
          Phụ thu đơn: {preview.order_surcharges.map(item => item.name + ": " + formatMoney(item.amount)).join("; ")}
        </p>}
        <p style={{ textAlign: "right" }}><b>Tổng đơn: {formatMoney(preview.total_amount)}</b></p>
        <Alert showIcon type="warning" message="Chưa đủ điều kiện phát hành từ POS"
          description={<ul style={{ marginBottom: 0 }}>{preview.warnings.map((text, index) =>
            <li key={index}>{text}</li>)}</ul>} />
      </>}
    </Modal>
  </>;
}

export function EinvoiceSettingsPanel() {
  const [data, setData] = useState<EinvoiceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    void getEinvoiceSettings().then(setData).catch(() => messageApi.error("Không tải được cấu hình MISA."));
  }, []);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const saved = await updateEinvoiceSettings({
        environment: data.environment, company_tax_code: data.company_tax_code,
        invoice_series: data.invoice_series
      });
      setData(saved);
      messageApi.success("Đã lưu thông tin MISA. Nguồn phát hành vẫn là CUKCUK.");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không lưu được cấu hình.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    {contextHolder}
    <Card title="Kết nối MISA meInvoice" loading={!data}>
      <Alert type="warning" showIcon style={{ marginBottom: 16 }}
        message="Chế độ an toàn: CUKCUK vẫn phát hành thật"
        description="Không nhập AppID, mật khẩu hay Access Token vào màn hình này. Chưa cho phép kích hoạt phát hành trực tiếp khi chưa hoàn thành nghiệm thu."/>
      {data && <Space direction="vertical" size="middle" style={{ width: "100%", maxWidth: 520 }}>
        <div><Text strong>Nhà cung cấp</Text><Input readOnly value="MISA meInvoice"/></div>
        <div><Text strong>Nguồn phát hành thực tế</Text><Input readOnly value="CUKCUK"/></div>
        <div><Text strong>Môi trường chuẩn bị</Text>
          <Select style={{ width: "100%" }} value={data.environment}
            onChange={value => setData({ ...data, environment: value })}
            options={[{ value: "SANDBOX", label: "Thử nghiệm (Sandbox)" },
              { value: "PRODUCTION", label: "Chính thức (chỉ lưu cấu hình, không kích hoạt)" }]}/>
        </div>
        <div><Text strong>Mã số thuế người bán</Text>
          <Input maxLength={32} value={data.company_tax_code}
            onChange={event => setData({ ...data, company_tax_code: event.target.value })}/>
        </div>
        <div><Text strong>Ký hiệu mẫu hóa đơn MISA</Text>
          <Input maxLength={32} value={data.invoice_series}
            onChange={event => setData({ ...data, invoice_series: event.target.value })}
            placeholder="Nhập đúng ký hiệu đã đăng ký với MISA"/>
        </div>
        <Button type="primary" loading={saving} onClick={() => void save()}>Lưu cấu hình</Button>
      </Space>}
    </Card>
  </>;
}
