import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Layout,
  Menu,
  message,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography
} from "antd";
import type { MenuProps, TableProps } from "antd";

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

const menuItems: MenuProps["items"] = [
  { key: "dashboard", label: "Tổng quan" },
  {
    key: "sales",
    label: "Bán hàng",
    children: [
      { key: "sales-pos", label: "POS (Bán hàng)" },
      { key: "sales-invoices", label: "Hóa đơn" },
      { key: "sales-returns", label: "Trả hàng" }
    ]
  },
  {
    key: "items",
    label: "Hàng hóa",
    children: [
      { key: "item-list", label: "Danh sách hàng hóa" },
      { key: "item-groups", label: "Nhóm hàng hóa" },
      { key: "units", label: "Đơn vị tính" }
    ]
  },
  {
    key: "purchases",
    label: "Nhập hàng",
    children: [
      { key: "purchase-orders", label: "Phiếu nhập" },
      { key: "suppliers", label: "Nhà cung cấp" }
    ]
  },
  {
    key: "inventory",
    label: "Kho",
    children: [
      { key: "stock", label: "Tồn kho" },
      { key: "stock-count", label: "Kiểm kho" }
    ]
  },
  {
    key: "cash",
    label: "Thu chi",
    children: [
      { key: "cash-transactions", label: "Thu chi" },
      { key: "cash-categories", label: "Danh mục thu chi" }
    ]
  },
  {
    key: "reports",
    label: "Báo cáo",
    children: [
      { key: "report-revenue", label: "Doanh thu" },
      { key: "report-stock", label: "Tồn kho" },
      { key: "report-purchases", label: "Nhập hàng" },
      { key: "report-cash", label: "Thu chi" },
      { key: "report-profit", label: "Lợi nhuận (sau này)" }
    ]
  },
  { key: "settings", label: "Cài đặt" }
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value) + " đ";
}

function Dashboard({ onNavigate }: { onNavigate: (key: string) => void }) {
  const today = new Intl.DateTimeFormat("vi-VN").format(new Date());

  const metricCards = [
    { label: "Doanh thu hôm nay", value: 0, suffix: "đ", tone: "green" },
    { label: "Chi phí hôm nay", value: 0, suffix: "đ", tone: "red" },
    { label: "Lợi nhuận tạm tính", value: 0, suffix: "đ", tone: "blue" },
    { label: "Số hóa đơn", value: 0, suffix: "", tone: "orange" }
  ];

  const quickActions = [
    { label: "Bán hàng (POS)", target: "sales-pos", disabled: true },
    { label: "Nhập hàng", target: "purchase-orders", disabled: true },
    { label: "Thu chi", target: "cash-transactions", disabled: true },
    { label: "Thêm hàng hóa", target: "item-list", disabled: true },
    { label: "Nhóm hàng hóa", target: "item-groups", disabled: false }
  ];

  return (
    <>
      <div className="dashboard-heading">
        <div>
          <Title level={2}>Tổng quan</Title>
          <Text type="secondary">
            Dữ liệu sẽ tự cập nhật khi từng nghiệp vụ được triển khai.
          </Text>
        </div>
        <div className="today-chip">Hôm nay: {today}</div>
      </div>

      <Row gutter={[14, 14]} className="metrics-row">
        {metricCards.map((metric) => (
          <Col xs={24} sm={12} xl={6} key={metric.label}>
            <Card className={`metric-card metric-${metric.tone}`} bordered={false}>
              <Statistic
                title={metric.label}
                value={metric.value}
                precision={0}
                suffix={metric.suffix}
                formatter={(value) =>
                  metric.suffix === "đ"
                    ? new Intl.NumberFormat("vi-VN").format(Number(value))
                    : String(value)
                }
              />
              <Text type="secondary" className="metric-note">
                Chưa có dữ liệu
              </Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[14, 14]} className="dashboard-grid">
        <Col xs={24} xl={16}>
          <Card
            className="dashboard-card"
            title="Doanh thu 7 ngày gần nhất"
            extra={<Select value="7 ngày" options={[{ value: "7 ngày", label: "7 ngày" }]} />}
          >
            <div className="empty-chart">
              <div className="chart-bars" aria-hidden="true">
                {[18, 28, 24, 40, 34, 48, 42].map((height, index) => (
                  <div className="chart-column" key={index}>
                    <div className="chart-bar" style={{ height: `${height}%` }} />
                  </div>
                ))}
              </div>
              <div className="empty-overlay">
                <Text strong>Chưa có dữ liệu bán hàng</Text>
                <Text type="secondary">Biểu đồ sẽ xuất hiện khi POS được triển khai.</Text>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card className="dashboard-card" title="Cơ cấu doanh thu theo nhóm hàng">
            <div className="donut-placeholder">
              <Progress
                type="circle"
                percent={0}
                size={190}
                format={() => "0%"}
                strokeWidth={14}
              />
              <Text type="secondary">Chưa có dữ liệu doanh thu.</Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card className="dashboard-card" title="Top món bán chạy hôm nay">
            <div className="compact-empty">
              <Text strong>Chưa có dữ liệu bán hàng</Text>
              <Text type="secondary">Top món sẽ được tính từ hóa đơn POS.</Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            className="dashboard-card"
            title="Tồn kho sắp hết"
            extra={<Tag>0 mặt hàng</Tag>}
          >
            <div className="compact-empty">
              <Text strong>Chưa có dữ liệu tồn kho</Text>
              <Text type="secondary">Sẽ hoạt động sau khi xây Hàng hóa và Nhập hàng.</Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card className="dashboard-card" title="Hoạt động gần đây">
            <div className="activity-placeholder">
              <div className="activity-dot" />
              <div>
                <Text strong>Khởi tạo hệ thống Ốc 11</Text>
                <div><Text type="secondary">Trang quản lý đang được xây từng chức năng.</Text></div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]} className="dashboard-bottom">
        <Col xs={24} xl={15}>
          <Card className="dashboard-card" title="Thao tác nhanh">
            <div className="quick-actions">
              {quickActions.map((action) => (
                <Button
                  key={action.label}
                  type={action.disabled ? "default" : "primary"}
                  disabled={action.disabled}
                  onClick={() => onNavigate(action.target)}
                  className="quick-action-btn"
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <Card className="dashboard-card" title="Báo cáo nhanh">
            <div className="report-links">
              <Button disabled>Xem doanh thu</Button>
              <Button disabled>Xem tồn kho</Button>
              <Button disabled>Xem nhập hàng</Button>
              <Button disabled>Xem thu chi</Button>
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
}

function ItemGroupsPage() {
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
    <>
      {messageContext}
      <div className="page-heading">
        <div>
          <Title level={2}>Nhóm hàng hóa</Title>
          <Text type="secondary">Quản lý nhóm nguyên vật liệu và hàng hóa.</Text>
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

          <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
            <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng" />
          </Form.Item>
        </Form>

        {editingGroup && (
          <Space>
            <Text type="secondary">Nhóm hàng hóa không có chức năng xóa.</Text>
          </Space>
        )}
      </Modal>
    </>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <Card className="placeholder-page">
      <Title level={2}>{title}</Title>
      <Text type="secondary">
        Chức năng này chưa được triển khai. Ốc 11 sẽ xây theo quy trình
        IDEA → DATABASE → UI → IMPLEMENT → TEST → LOCK.
      </Text>
    </Card>
  );
}

const pageTitles: Record<string, string> = {
  "sales-pos": "POS (Bán hàng)",
  "sales-invoices": "Hóa đơn",
  "sales-returns": "Trả hàng",
  "item-list": "Danh sách hàng hóa",
  "units": "Đơn vị tính",
  "purchase-orders": "Phiếu nhập",
  "suppliers": "Nhà cung cấp",
  stock: "Tồn kho",
  "stock-count": "Kiểm kho",
  "cash-transactions": "Thu chi",
  "cash-categories": "Danh mục thu chi",
  "report-revenue": "Báo cáo doanh thu",
  "report-stock": "Báo cáo tồn kho",
  "report-purchases": "Báo cáo nhập hàng",
  "report-cash": "Báo cáo thu chi",
  "report-profit": "Báo cáo lợi nhuận",
  settings: "Cài đặt"
};

function App() {
  const [page, setPage] = useState("dashboard");

  const renderPage = () => {
    if (page === "dashboard") {
      return <Dashboard onNavigate={setPage} />;
    }

    if (page === "item-groups") {
      return <ItemGroupsPage />;
    }

    return <PlaceholderPage title={pageTitles[page] ?? "Ốc 11"} />;
  };

  return (
    <Layout className="app-shell">
      <Sider width={250} className="sidebar" breakpoint="lg" collapsedWidth="0">
        <div className="brand">
          <div className="brand-mark">ỐC</div>
          <div>
            <div className="brand-title">Ốc 11</div>
            <div className="brand-subtitle">Ăn hải sản trên núi<br />chất lượng như ở biển</div>
          </div>
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          defaultOpenKeys={["items"]}
          items={menuItems}
          onClick={({ key }) => setPage(key)}
          className="main-menu"
        />
      </Sider>

      <Layout>
        <Header className="topbar">
          <div className="topbar-left">
            <Text strong className="topbar-title">
              {page === "dashboard" ? "Tổng quan" : pageTitles[page] ?? "Ốc 11 Manager"}
            </Text>
          </div>
          <div className="topbar-right">
            <Text type="secondary">Quản lý</Text>
          </div>
        </Header>

        <Content className="content">{renderPage()}</Content>
      </Layout>
    </Layout>
  );
}

export default App;
