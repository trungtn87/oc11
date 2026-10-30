import { Button, Card, Col, Empty, Progress, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import type { FundAccount, FundTransaction, InventoryStock, PurchaseReceipt, SaleOrder } from "./types";

const { Text } = Typography;
const money = (value: number) => new Intl.NumberFormat("vi-VN").format(value) + " đ";
const dateKey = (value: string) => value.slice(0, 10);

type Props = {
  from: string;
  to: string;
  orders: SaleOrder[];
  receipts: PurchaseReceipt[];
  accounts: FundAccount[];
  transactions: FundTransaction[];
  stock: InventoryStock[];
  loading: boolean;
  onNavigate: (key: string) => void;
};

export default function DashboardInsights({
  from, to, orders, receipts, accounts, transactions, stock, loading, onNavigate
}: Props) {
  const within = (value: string) => Boolean(from && to && dateKey(value) >= from && dateKey(value) <= to);
  const sales = orders.filter((order) => order.status !== "VOID" && within(order.order_time));
  const purchases = receipts.filter((receipt) => !receipt.is_void && within(receipt.receipt_time));
  const movements = transactions.filter((entry) => within(entry.transaction_time) && entry.transaction_type === "NORMAL");
  const revenue = sales.reduce((sum, order) => sum + order.total_amount, 0);

  // Outstanding order totals are provisional: open orders can also have DEBT settlement_status.
  // They must not be presented as a reconciled customer receivables ledger.
  const unsettledOrders = orders.filter((order) => order.status !== "VOID" && order.settlement_status === "DEBT");
  const unpaidPurchases = receipts.filter((receipt) => !receipt.is_void && receipt.payment_status === "DEBT");

  const daily = new Map<string, { date: string; amount: number; count: number }>();
  for (const order of sales) {
    const day = dateKey(order.order_time);
    const row = daily.get(day) ?? { date: day, amount: 0, count: 0 };
    row.amount += order.total_amount;
    row.count += 1;
    daily.set(day, row);
  }
  const trend = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  const maxDaily = Math.max(1, ...trend.map((day) => day.amount));

  const items = new Map<string, { name: string; quantity: number; amount: number }>();
  for (const order of sales) {
    for (const item of order.items) {
      const key = String(item.menu_item_id ?? item.item_name_snapshot);
      const old = items.get(key) ?? { name: item.item_name_snapshot, quantity: 0, amount: 0 };
      old.quantity += item.quantity;
      old.amount += item.total_with_surcharges;
      items.set(key, old);
    }
  }
  const topItems = [...items.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  const byFund = accounts.map((account) => ({
    key: account.id, name: account.name, type: account.type === "CASH" ? "Tiền mặt" : "Ngân hàng",
    balance: account.current_balance
  }));
  const receiptsIn = movements.filter((item) => item.direction === "IN").reduce((sum, item) => sum + item.amount, 0);
  const paymentsOut = movements.filter((item) => item.direction === "OUT").reduce((sum, item) => sum + item.amount, 0);
  const emptyStock = stock.filter((item) => item.is_stock_tracked && item.stock_quantity <= 0);
  const negativeStock = emptyStock.filter((item) => item.stock_quantity < 0);

  const navigate = (label: string, key: string) => <Button size="small" onClick={() => onNavigate(key)}>{label}</Button>;

  return (
    <div className="dashboard-insights">
      <Row gutter={[14, 14]}>
        <Col xs={24} lg={12}>
          <Card title="1. Tổng quan điều hành" loading={loading} extra={navigate("Đơn bán hàng", "sales-orders")}>
            <Row gutter={[12, 12]}>
              <Col xs={12}><Statistic title="Đơn trong kỳ" value={sales.length} /></Col>
              <Col xs={12}><Statistic title="Doanh thu đơn" value={revenue} formatter={(v) => money(Number(v))} /></Col>
              <Col xs={12}><Statistic title="Đơn chưa tất toán (toàn kỳ)" value={unsettledOrders.length} /></Col>
              <Col xs={12}><Statistic title="Mặt hàng hết/âm tồn" value={emptyStock.length} valueStyle={emptyStock.length ? { color: "#cf1322" } : undefined} /></Col>
            </Row>
            <Text type="secondary">Doanh thu đơn là tổng giá trị đơn chưa hủy, không phải số tiền đã thu. Đơn chưa tất toán có thể gồm đơn đang phục vụ.</Text>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="2. Bán hàng" loading={loading} extra={navigate("Xem bán hàng", "sales-orders")}>
            <Text strong>Doanh thu theo ngày trong kỳ</Text>
            <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 10 }}>
              {trend.length ? trend.slice(-14).map((day) => (
                <div key={day.date} style={{ display: "grid", gridTemplateColumns: "78px 1fr 116px", gap: 8, alignItems: "center" }}>
                  <Text type="secondary">{day.date.slice(5)}</Text>
                  <Progress showInfo={false} percent={Math.round(day.amount / maxDaily * 100)} />
                  <Text style={{ textAlign: "right" }}>{money(day.amount)}</Text>
                </div>
              )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có đơn bán trong kỳ" />}
            </div>
            <Text strong>Món bán nhiều (theo số lượng)</Text>
            <Table size="small" pagination={false} rowKey="name" dataSource={topItems} columns={[
              { title: "Món", dataIndex: "name", ellipsis: true },
              { title: "SL", dataIndex: "quantity", align: "right" },
              { title: "Tổng tiền", dataIndex: "amount", align: "right", render: money }
            ]} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="3. Tài chính & quỹ" loading={loading} extra={navigate("Sổ tiền", "money-ledgers")}>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="green">Thu thông thường: {money(receiptsIn)}</Tag>
              <Tag color="red">Chi thông thường: {money(paymentsOut)}</Tag>
              <Tag>Chênh lệch: {money(receiptsIn - paymentsOut)}</Tag>
            </Space>
            <Table size="small" pagination={false} rowKey="key" dataSource={byFund} columns={[
              { title: "Quỹ / tài khoản", dataIndex: "name", ellipsis: true },
              { title: "Loại", dataIndex: "type", responsive: ["sm"] },
              { title: "Số dư hiện tại", dataIndex: "balance", align: "right", render: money }
            ]} />
            <Text type="secondary">Không tính chuyển quỹ/cân đối vào thu chi thông thường. Số dư là giá trị hiện tại, không phụ thuộc khoảng ngày.</Text>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="4. Theo dõi chưa thanh toán" loading={loading} extra={navigate("Phiếu nhập", "purchase-orders")}>
            <Row gutter={[12, 12]}>
              <Col xs={12}><Statistic title="Đơn bán chưa tất toán" value={unsettledOrders.length} /></Col>
              <Col xs={12}><Statistic title="Phiếu nhập chưa thanh toán" value={unpaidPurchases.length} /></Col>
            </Row>
            <Text type="secondary">Đây là số chứng từ theo trạng thái hiện hành, không phải số dư công nợ đã đối soát. Chưa tính nợ quá hạn hoặc số tiền còn nợ khi thiếu lịch sử thanh toán chi tiết.</Text>
            <div style={{ marginTop: 12 }}>{navigate("Mở danh sách đơn bán", "sales-orders")}</div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="5. Kho & nhập hàng" loading={loading} extra={navigate("Tồn kho", "stock")}>
            <Row gutter={[12, 12]}>
              <Col xs={8}><Statistic title="Hết/âm tồn" value={emptyStock.length} /></Col>
              <Col xs={8}><Statistic title="Tồn âm" value={negativeStock.length} /></Col>
              <Col xs={8}><Statistic title="Phiếu nhập kỳ" value={purchases.length} /></Col>
            </Row>
            <div style={{ marginTop: 12 }}>
              {emptyStock.slice(0, 5).map((item) => (
                <div key={item.item_id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
                  <Text ellipsis>{item.item_name}</Text>
                  <Text type="danger">{item.stock_quantity} {item.smallest_unit_name}</Text>
                </div>
              ))}
            </div>
            <Text type="secondary">Danh sách tồn hiển thị theo đơn vị nhỏ nhất của API; mở Tồn kho để xem đơn vị hiển thị nghiệp vụ.</Text>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="6. Báo cáo quản trị" loading={loading}>
            <Space wrap>{navigate("Đơn bán hàng", "sales-orders")}{navigate("Sổ tiền", "money-ledgers")}{navigate("Nhập hàng", "purchase-orders")}</Space>
            <div style={{ marginTop: 16 }}>
              <Tag>Chưa đủ dữ liệu đối soát</Tag>
              <Text>Lợi nhuận thực tế, hòa vốn, dự báo dòng tiền và nợ quá hạn chưa được hiển thị để tránh số liệu sai.</Text>
            </div>
            <div style={{ marginTop: 12 }}><Text type="secondary">Báo cáo hiện có là tổng hợp đọc dữ liệu; không phát sinh thu chi hoặc thay đổi chứng từ.</Text></div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
