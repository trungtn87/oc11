import { useEffect, useState } from "react";
import { getFundAccounts, getInventoryStock, getPurchaseReceipts, getSaleOrders } from "./api";
import type { FundAccount, InventoryStock, PurchaseReceipt, SaleOrder } from "./types";
import { displayStockQuantity, displayStockUnit, stockInventoryValue } from "./stockDisplay";

const currency = (value: number) => new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0
}).format(Math.round(value)) + " đ";

const quantity = (value: number) => new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 3
}).format(value);

function localToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

type DashboardData = {
  sales: SaleOrder[];
  purchases: PurchaseReceipt[];
  accounts: FundAccount[];
  stock: InventoryStock[];
};

export default function PosDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const date = localToday();
        const [sales, purchases, accounts, stock] = await Promise.all([
          getSaleOrders({ from_date: date, to_date: date }),
          getPurchaseReceipts(),
          getFundAccounts(),
          getInventoryStock({ tracking: "TRACKED" })
        ]);
        if (!disposed) setData({ sales, purchases, accounts, stock });
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : "Không lấy được số liệu.");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void load();
    return () => { disposed = true; };
  }, [reloadKey]);

  const today = localToday();
  // OPEN orders are not recognized as revenue until checkout.
  const sales = (data?.sales ?? []).filter(
    (order) => order.status === "PAID" && order.order_time.slice(0, 10) === today
  );
  const paidSales = sales.filter((order) => order.settlement_status === "PAID");
  const debtSales = sales.filter((order) => order.settlement_status === "DEBT");
  const revenue = sales.reduce((sum, row) => sum + row.total_amount, 0);
  const collected = paidSales.reduce(
    (sum, row) => sum + (row.actual_received_amount ?? row.total_amount), 0
  );
  const debtRevenue = debtSales.reduce((sum, row) => sum + row.total_amount, 0);

  const purchases = (data?.purchases ?? []).filter(
    (row) => !row.is_void && row.receipt_time.slice(0, 10) === today
  );
  const purchased = purchases.reduce((sum, row) => sum + row.total_amount, 0);
  const purchaseDebt = purchases.reduce((sum, row) => {
    if (row.payment_status !== "DEBT") return sum;
    // Shipping can be paid separately from goods on a debt receipt.
    const shippingPaid = row.shipping_payment_reference_code !== null ? row.shipping_fee : 0;
    return sum + row.total_amount - shippingPaid;
  }, 0);
  const purchasePaid = purchased - purchaseDebt;

  const accounts = data?.accounts ?? [];
  const balance = accounts.reduce((sum, row) => sum + row.current_balance, 0);
  const alertStock = (data?.stock ?? [])
    .filter((row) => row.is_active && row.is_stock_tracked && row.stock_quantity <= 0)
    .sort((a, b) => displayStockQuantity(a) - displayStockQuantity(b) || a.item_name.localeCompare(b.item_name, "vi"));
  const negativeCount = alertStock.filter((row) => row.stock_quantity < 0).length;
  const zeroCount = alertStock.length - negativeCount;
  const stockTotal = (data?.stock ?? []).reduce(
    (sum, row) => sum + (stockInventoryValue(row) ?? 0), 0
  );

  return (
    <main className="pos-dashboard">
      <div className="pos-dashboard-heading">
        <div>
          <h1>Tổng quan Ốc 11</h1>
          <p>Hoạt động hôm nay · {new Intl.DateTimeFormat("vi-VN").format(new Date())}</p>
        </div>
        <button type="button" onClick={() => setReloadKey((value) => value + 1)}
          disabled={loading} className="pos-dashboard-refresh">
          {loading ? "Đang tải..." : "↻ Làm mới"}
        </button>
      </div>

      {error && <div className="pos-dashboard-error" role="alert">
        {error} <button type="button" onClick={() => setReloadKey((value) => value + 1)}>Thử lại</button>
      </div>}

      <div className="pos-dashboard-metrics">
        <div className="pos-dashboard-metric">
          <span>Doanh thu hôm nay</span>
          <strong>{currency(revenue)}</strong>
          <small>{sales.length} đơn hoàn tất · Đã thu {currency(collected)} · Ghi nợ {currency(debtRevenue)}</small>
        </div>
        <div className="pos-dashboard-metric">
          <span>Nhập hàng hôm nay</span>
          <strong>{currency(purchased)}</strong>
          <small>{purchases.length} phiếu nhập · Đã trả {currency(purchasePaid)} · Còn nợ {currency(purchaseDebt)}</small>
        </div>
        <div className="pos-dashboard-metric">
          <span>Tổng số dư quỹ và tài khoản</span>
          <strong>{currency(balance)}</strong>
          <small>{accounts.length} quỹ / tài khoản · Số dư hiện tại</small>
        </div>
        <div className="pos-dashboard-metric pos-dashboard-metric-alert">
          <span>Mặt hàng tồn ≤ 0</span>
          <strong>{alertStock.length}</strong>
          <small>{negativeCount} tồn âm · {zeroCount} bằng 0</small>
        </div>
      </div>

      <div className="pos-dashboard-details">
        <section className="pos-dashboard-panel">
          <h2>Hoạt động hôm nay</h2>
          <div className="pos-dashboard-section-title">Bán hàng</div>
          <div className="pos-dashboard-line"><span>Số đơn hoàn tất</span><strong>{sales.length}</strong></div>
          <div className="pos-dashboard-line"><span>Doanh thu</span><strong>{currency(revenue)}</strong></div>
          <div className="pos-dashboard-line"><span>Trung bình / đơn</span><strong>{currency(sales.length ? revenue / sales.length : 0)}</strong></div>
          <div className="pos-dashboard-section-title">Nhập hàng</div>
          <div className="pos-dashboard-line"><span>Số phiếu nhập</span><strong>{purchases.length}</strong></div>
          <div className="pos-dashboard-line"><span>Tổng nhập</span><strong>{currency(purchased)}</strong></div>
          <div className="pos-dashboard-line"><span>Phiếu còn nợ</span><strong>{purchases.filter((row) => row.payment_status === "DEBT").length}</strong></div>
        </section>
        <section className="pos-dashboard-panel">
          <h2>Số dư từng quỹ / tài khoản</h2>
          {accounts.length === 0 ? <p className="pos-dashboard-empty">Chưa có quỹ / tài khoản.</p> : (
            accounts.map((account) => (
              <div className="pos-dashboard-account" key={account.id}>
                <span className="pos-dashboard-account-icon">{account.type === "BANK" ? "▣" : "₫"}</span>
                <div>
                  <strong>{account.name}</strong>
                  <small>{account.type === "BANK" ? (account.bank_name || "Ngân hàng") : "Tiền mặt"}{!account.is_active ? " · Ngừng sử dụng" : ""}</small>
                </div>
                <b>{currency(account.current_balance)}</b>
              </div>
            ))
          )}
        </section>
      </div>

      <section className="pos-dashboard-panel pos-dashboard-stock">
        <div className="pos-dashboard-stock-title">
          <div>
            <h2>Cảnh báo hàng hết / tồn âm</h2>
            <p>Chỉ mặt hàng đang theo dõi · Giá trị tồn dương ước tính: {currency(stockTotal)}</p>
          </div>
          <span>{alertStock.length} mặt hàng</span>
        </div>
        <div className="pos-dashboard-table-wrap">
          <table>
            <thead><tr><th>Hàng hóa</th><th>Tồn hiện tại</th><th>ĐVT</th><th>Giá nhập gần nhất</th><th>Giá trị tồn</th></tr></thead>
            <tbody>
              {alertStock.map((stock) => (
                <tr key={stock.item_id}>
                  <td><strong>{stock.item_name}</strong></td>
                  <td className={stock.stock_quantity < 0 ? "pos-dashboard-negative" : "pos-dashboard-zero"}>
                    {quantity(displayStockQuantity(stock))}
                  </td>
                  <td>{displayStockUnit(stock)}{!stock.last_purchase_unit_name ? " (mặc định)" : ""}</td>
                  <td>{stock.last_purchase_unit_price === null ? "—" : currency(stock.last_purchase_unit_price)}</td>
                  <td>{currency(stockInventoryValue(stock) ?? 0)}</td>
                </tr>
              ))}
              {!alertStock.length && <tr><td colSpan={5} className="pos-dashboard-empty">
                {loading ? "Đang tải tồn kho..." : "Không có mặt hàng tồn bằng 0 hoặc âm."}
              </td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
