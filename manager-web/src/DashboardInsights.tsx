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
  // A sale is genuinely owed only after it is closed as DEBT, not while the table is OPEN.
  const unsettledOrders = orders.filter((order) => order.status === "PAID" && order.settlement_status === "DEBT");
  const openOrders = orders.filter((order) => order.status === "OPEN");
  const unpaidPurchases = receipts.filter((receipt) => !receipt.is_void && receipt.payment_status === "DEBT");
  const customerDebt = unsettledOrders.reduce((sum, order) => sum + order.total_amount, 0);
  const supplierDebt = unpaidPurchases.reduce((sum, receipt) => sum + receipt.total_amount, 0);
  const paidSales = sales.filter((order) => order.status === "PAID");
  // Real cash receipts are taken from the ledger by transaction date: includes
  // collections of earlier debt without incorrectly attributing them to today's sales.
  const salesCash = transactions
    .filter((entry) => within(entry.transaction_time) &&
      entry.transaction_type === "NORMAL" && entry.direction === "IN" && entry.source_type === "SALE");
  const saleCashTotal = salesCash.reduce((sum, entry) => sum + entry.amount, 0);
  const cashTotal = salesCash.filter((entry) => entry.account_type === "CASH")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const bankTotal = saleCashTotal - cashTotal;

  // Snapshot-based gross profit (not net/operating profit). Never treat missing
  // costs as zero or purchases as expenses, and do not use current stock pricing.
  const costLines = paidSales.flatMap((order) => order.items);
  const costComplete = paidSales.length > 0 &&
    paidSales.every((order) => order.items.length > 0) &&
    costLines.every((item) => item.cost_total_snapshot != null &&
      Number.isFinite(item.cost_total_snapshot));
  const settledRevenue = paidSales.reduce((sum, order) => sum + order.total_amount, 0);
  const costOfSales = costComplete
    ? costLines.reduce((sum, item) => sum + Number(item.cost_total_snapshot), 0)
    : null;
  const grossProfit = costOfSales === null ? null : settledRevenue - costOfSales;

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
  // Cost completeness is independently checked for each dish. These are gross
  // profit estimates from line snapshots, not operational net profit.
  const dishes = new Map<string, { key: string; name: string; sales: number; cost: number; complete: boolean }>();
  for (const order of paidSales) for (const item of order.items) {
    const key = String(item.menu_item_id ?? item.item_name_snapshot);
    const current = dishes.get(key) ?? { key, name: item.item_name_snapshot, sales: 0, cost: 0, complete: true };
    current.sales += item.total_with_surcharges;
    if (item.cost_total_snapshot == null || !Number.isFinite(item.cost_total_snapshot)) current.complete = false;
    else current.cost += item.cost_total_snapshot;
    dishes.set(key, current);
  }
  const dishPerformance = [...dishes.values()].sort((a, b) => b.sales - a.sales).slice(0, 5);

  const byFund = accounts.map((account) => ({
    key: account.id, name: account.name, type: account.type === "CASH" ? "Tiền mặt" : "Ngân hàng",
    balance: account.current_balance
  }));
  const receiptsIn = movements.filter((item) => item.direction === "IN").reduce((sum, item) => sum + item.amount, 0);
  const paymentsOut = movements.filter((item) => item.direction === "OUT").reduce((sum, item) => sum + item.amount, 0);
  const emptyStock = stock.filter((item) => item.is_stock_tracked && item.stock_quantity <= 0);
  const negativeStock = emptyStock.filter((item) => item.stock_quantity < 0);
  const stockValuations = stock.filter((item) => item.is_stock_tracked && item.stock_quantity > 0);
  const stockValueComplete = stockValuations.every((item) =>
    item.last_purchase_price_per_smallest_unit !== null &&
    Number.isFinite(item.last_purchase_price_per_smallest_unit));
  const stockValuation = stockValueComplete
    ? stockValuations.reduce((sum, item) =>
        sum + item.stock_quantity * Number(item.last_purchase_price_per_smallest_unit), 0)
    : null;

  const navigate = (label: string, key: string) => <Button size="small" onClick={() => onNavigate(key)}>{label}</Button>;

  return (
    <div className="dashboard-insights">
      <Row gutter={[14, 14]}>
        <Col xs={24} lg={12}>
          <Card title="1. Tổng quan điều hành" loading={loading} extra={navigate("Đơn bán hàng", "sales-orders")}>
            <Row gutter={[12, 12]}>
              <Col xs={12}><Statistic title="Đơn trong kỳ" value={sales.length} /></Col>
              <Col xs={12}><Statistic title="Doanh thu đơn" value={revenue} formatter={(v) => money(Number(v))} /></Col>
              <Col xs={12}><Statistic title="Đơn đang phục vụ" value={openOrders.length} /></Col>
              <Col xs={12}><Statistic title="Mặt hàng hết/âm tồn" value={emptyStock.length} valueStyle={emptyStock.length ? { color: "#cf1322" } : undefined} /></Col>
            </Row>
            <Space direction="vertical" size={3} style={{ marginTop: 10 }}>
              <Text strong>Thực thu bán hàng trong kỳ: {money(saleCashTotal)}</Text>
              <Text type="secondary">Lấy từ phiếu thu nguồn SALE theo ngày phát sinh; bao gồm thu nợ cũ. Doanh thu đơn và thực thu không cùng thời điểm ghi nhận.</Text>
            </Space>
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
            <div style={{ marginTop: 10, marginBottom: 8 }}>
              <Space wrap>
                <Tag>Tiền mặt: {money(cashTotal)}</Tag>
                <Tag>Chuyển khoản: {money(bankTotal)}</Tag>
              </Space>
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
            <div style={{ marginTop: 12, marginBottom: 8 }}>
              <Statistic title="Giá trị đơn ghi nợ đang mở" value={customerDebt} formatter={(v) => money(Number(v))} />
              <Statistic title="Giá trị phiếu nhập chưa thanh toán" value={supplierDebt} formatter={(v) => money(Number(v))} />
            </div>
            <Text type="secondary">Chỉ tính đơn đã đóng và ghi nợ; không tính bàn đang phục vụ. Hai tổng trên là giá trị chứng từ chưa thanh toán theo trạng thái hiện hành, chưa phải sổ công nợ đối soát theo từng lần trả. Chưa có căn cứ tính quá hạn.</Text>
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
            <div style={{ marginTop: 10 }}>
              <Text strong>Giá trị tồn ước tính theo giá nhập gần nhất: {stockValuation === null ? "Chưa đủ dữ liệu giá" : money(stockValuation)}</Text>
            </div>
            <Text type="secondary">Không phải giá vốn kế toán. Chỉ tính tồn dương có giá nhập; khi thiếu giá sẽ không tính tổng. Mở Tồn kho để xem đơn vị tính nhập gần nhất.</Text>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="6. Báo cáo quản trị" loading={loading}>
            <Space wrap>{navigate("Đơn bán hàng", "sales-orders")}{navigate("Sổ tiền", "money-ledgers")}{navigate("Nhập hàng", "purchase-orders")}</Space>
            <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
              <Col xs={12}><Statistic title="Doanh thu đơn đã đóng trong kỳ" value={settledRevenue} formatter={(v) => money(Number(v))} /></Col>
              <Col xs={12}><Statistic title="Giá vốn snapshot" value={costOfSales === null ? "Chưa đủ dữ liệu" : money(costOfSales)} /></Col>
              <Col xs={24}><Statistic title="Lãi gộp theo snapshot" value={grossProfit === null ? "Chưa đủ dữ liệu" : money(grossProfit)} /></Col>
            </Row>
            <Text type="secondary">Lãi gộp = tổng đơn đã đóng − giá vốn snapshot của tất cả món. Không phải lợi nhuận ròng; chưa trừ chi phí vận hành, thuế và các khoản điều chỉnh. Thiếu một giá vốn sẽ không hiển thị tổng.</Text>
            <div style={{ marginTop: 16 }}>
              <Text strong>Hiệu quả món đã bán (giá vốn snapshot)</Text>
              <Table size="small" pagination={false} rowKey="key" dataSource={dishPerformance} columns={[
                { title: "Món", dataIndex: "name", ellipsis: true },
                { title: "Doanh thu", dataIndex: "sales", align: "right", render: money },
                { title: "Lãi gộp", align: "right", render: (_, item) => item.complete ? money(item.sales - item.cost) : "Thiếu giá vốn" }
              ]} />
            </div>
            <div style={{ marginTop: 12 }}><Tag>Chưa đủ dữ liệu đối soát</Tag><Text>Lợi nhuận ròng, hòa vốn, dự báo dòng tiền và nợ quá hạn chưa có nguồn dữ liệu đầy đủ để tính an toàn.</Text></div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
