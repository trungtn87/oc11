import { useEffect, useRef, useState } from "react";
import { Button, InputNumber, message, Modal, Select, Spin } from "antd";
import {
  createFundTransaction,
  createPurchaseReceipt,
  getFundAccounts,
  getInventoryItems,
  getItemPurchaseDefaults,
  getSuppliers
} from "./api";
import type {
  FundAccount,
  InventoryItem,
  ItemPurchaseDefault,
  Supplier
} from "./types";
import "./PosQuickActions.css";

export type PosQuickAction = "TRANSFER" | "PURCHASE" | null;

type QuickLine = {
  key: number;
  item_id?: number;
  unit_id?: number;
  quantity?: number;
  unit_price?: number;
};

type Props = {
  action: PosQuickAction;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

const MARKET_CASH_ID = 3; // Giữ cùng cấu hình với app Android.
const MARKET_BANK_ID = 1; // BIDV trên app Android.
const formatMoney = (amount: number) => new Intl.NumberFormat("vi-VN").format(Math.round(amount));
const makeRequestId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "POS-" + Date.now() + "-" + Math.random().toString(36).slice(2);
const roundLineTotal = (value: number) => {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) < 1e-10) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
};
const localTimestamp = () => {
  const now = new Date();
  const pad = (number: number) => String(number).padStart(2, "0");
  return (
    now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) +
    "T" + pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds())
  );
};

function marketAccount(accounts: FundAccount[], type: "CASH" | "BANK"): FundAccount | undefined {
  const id = type === "CASH" ? MARKET_CASH_ID : MARKET_BANK_ID;
  return accounts.find((account) => account.id === id && account.type === type && account.is_active);
}

function defaultPurchaseAccount(accounts: FundAccount[]): FundAccount | undefined {
  const active = accounts.filter((account) => account.is_active);
  return active.find((account) => account.type === "CASH" && account.is_default)
    ?? active.find((account) => account.is_default)
    ?? active.find((account) => account.type === "CASH")
    ?? active[0];
}

function shopCashAccount(accounts: FundAccount[]): FundAccount | undefined {
  const cash = accounts.filter(
    (account) => account.is_active && account.type === "CASH" && account.id !== MARKET_CASH_ID
  );
  const normalized = (name: string) => name.normalize("NFC").trim().toLocaleLowerCase("vi");
  const byName = cash.filter((account) =>
    ["quỹ quán", "quỹ tiền mặt", "tiền mặt tại quán"].includes(normalized(account.name))
  );
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return undefined;
  const defaults = cash.filter((account) => account.is_default);
  if (defaults.length === 1) return defaults[0];
  return cash.length === 1 ? cash[0] : undefined;
}

export default function PosQuickActions({ action, onClose, onSaved }: Props) {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(false);
  const nextLineId = useRef(0);
  const requestId = useRef("");
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [defaults, setDefaults] = useState<ItemPurchaseDefault[]>([]);
  const [transferAmount, setTransferAmount] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState<number>();
  const [paymentFundAccountId, setPaymentFundAccountId] = useState<number>();
  const [lines, setLines] = useState<QuickLine[]>([]);

  useEffect(() => {
    if (!action) return;
    let cancelled = false;
    setLoading(true);
    setTransferAmount(null);
    setSupplierId(undefined);
    setPaymentFundAccountId(undefined);
    setLines([{ key: ++nextLineId.current }]);
    requestId.current = makeRequestId();
    void (async () => {
      try {
        if (action === "TRANSFER") {
          const funds = await getFundAccounts();
          if (!cancelled) setAccounts(funds);
        } else {
          const [funds, suppliersResult, itemsResult, defaultsResult] = await Promise.all([
            getFundAccounts(), getSuppliers(), getInventoryItems(), getItemPurchaseDefaults()
          ]);
          if (!cancelled) {
            setAccounts(funds);
            setPaymentFundAccountId(defaultPurchaseAccount(funds)?.id);
            setSuppliers(suppliersResult);
            setItems(itemsResult.filter((item) => item.is_active));
            setDefaults(defaultsResult);
          }
        }
      } catch (error) {
        if (!cancelled) messageApi.error(
          error instanceof Error ? error.message : "Không tải được dữ liệu để thao tác."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [action]);

  const source = shopCashAccount(accounts);
  const destination = marketAccount(accounts, "CASH");
  const purchaseAccounts = accounts.filter((account) => account.is_active);
  const paymentAccount = purchaseAccounts.find((account) => account.id === paymentFundAccountId);
  const total = lines.reduce((sum, line) =>
    sum + roundLineTotal((line.quantity ?? 0) * (line.unit_price ?? 0)), 0
  );
  const activeSuppliers = [...suppliers].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const activeItems = [...items].sort((a, b) => a.name.localeCompare(b.name, "vi"));

  function suggestedPrice(itemId: number, unitId: number): number | undefined {
    return defaults.find((row) => row.item_id === itemId)
      ?.unit_prices.find((row) => row.unit_id === unitId)?.suggested_unit_price;
  }

  function updateLine(key: number, update: Partial<QuickLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...update } : line));
  }

  function chooseItem(key: number, itemId: number) {
    const item = items.find((row) => row.id === itemId);
    const units = item?.conversions.filter((unit) => unit.is_active) ?? [];
    const preferred = units.find((unit) => unit.unit_id === item?.default_unit_id) ?? units[0];
    updateLine(key, {
      item_id: itemId,
      unit_id: preferred?.unit_id,
      unit_price: preferred ? suggestedPrice(itemId, preferred.unit_id) : undefined
    });
  }

  function chooseUnit(line: QuickLine, unitId: number) {
    updateLine(line.key, {
      unit_id: unitId,
      unit_price: line.item_id ? suggestedPrice(line.item_id, unitId) : undefined
    });
  }

  function notifyRefresh() {
    void onSaved().catch(() => messageApi.warning("Đã lưu, nhưng chưa làm mới được số dư. Vui lòng tải lại trang."));
  }

  async function submitTransfer() {
    if (submitLock.current) return;
    if (!source || !destination) {
      messageApi.error("Không xác định được Quỹ quán hoặc Quỹ đi chợ. Hãy kiểm tra quỹ trên Web quản lý.");
      return;
    }
    if (!transferAmount || !Number.isSafeInteger(transferAmount) || transferAmount <= 0) {
      messageApi.error("Nhập số tiền chuyển hợp lệ (VND).");
      return;
    }
    if (transferAmount > source.current_balance) {
      messageApi.error("Số dư Quỹ quán không đủ.");
      return;
    }
    submitLock.current = true;
    setSaving(true);
    try {
      await createFundTransaction({
        account_type: "CASH",
        fund_account_id: source.id,
        direction: "OUT",
        transaction_type: "TRANSFER",
        transaction_time: localTimestamp(),
        related_fund_account_id: destination.id,
        amount: transferAmount,
        description: "Chuyển tiền đi chợ từ POS"
      });
      messageApi.success("Đã chuyển " + formatMoney(transferAmount) + " đ sang Quỹ đi chợ và ghi sổ.");
      onClose();
      notifyRefresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không chuyển được tiền. Kiểm tra sổ quỹ trước khi thử lại.");
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  }

  async function submitPurchase() {
    if (submitLock.current) return;
    if (!supplierId) {
      messageApi.error("Chọn nhà cung cấp.");
      return;
    }
    if (!paymentAccount) {
      messageApi.error("Hãy chọn quỹ hoặc tài khoản ngân hàng đang hoạt động để thanh toán.");
      return;
    }
    if (lines.length === 0 || lines.some((line) =>
      !line.item_id || !line.unit_id || !Number.isFinite(line.quantity) ||
      (line.quantity ?? 0) <= 0 || !Number.isSafeInteger(line.unit_price) ||
      (line.unit_price ?? -1) < 0
    )) {
      messageApi.error("Điền đủ hàng hóa, đơn vị, số lượng và giá nhập ở tất cả dòng.");
      return;
    }
    if (!Number.isSafeInteger(total) || total < 0) {
      messageApi.error("Tổng tiền không hợp lệ.");
      return;
    }
    if (total > paymentAccount.current_balance) {
      messageApi.error("Số dư " + paymentAccount.name + " không đủ để thanh toán phiếu nhập.");
      return;
    }
    submitLock.current = true;
    setSaving(true);
    try {
      const receipt = await createPurchaseReceipt({
        client_sync_id: requestId.current,
        supplier_id: supplierId,
        receipt_time: localTimestamp(),
        description: null,
        shipping_fee: 0,
        actual_paid_amount: null,
        payment_status: "PAID",
        payment: { account_type: paymentAccount.type, fund_account_id: paymentAccount.id },
        shipping_payment: null,
        replaces_receipt_id: null,
        items: lines.map((line) => ({
          item_id: line.item_id as number,
          unit_id: line.unit_id as number,
          quantity: line.quantity as number,
          unit_price: line.unit_price as number,
          note: null
        }))
      });
      messageApi.success("Đã lưu " + receipt.receipt_code + ", cập nhật kho và sổ quỹ.");
      onClose();
      notifyRefresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không lưu được phiếu nhập.");
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  }

  const transferOpen = action === "TRANSFER";
  const purchaseOpen = action === "PURCHASE";
  return (
    <>
      {contextHolder}
      <Modal
        open={transferOpen}
        title="Chuyển tiền đi chợ"
        width={500}
        destroyOnClose
        maskClosable={!saving}
        closable={!saving}
        onCancel={() => { if (!saving) onClose(); }}
        footer={[
          <Button key="cancel" size="large" disabled={saving} onClick={onClose}>Đóng</Button>,
          <Button key="save" size="large" type="primary" loading={saving}
            disabled={loading || !source || !destination} onClick={() => void submitTransfer()}>
            Xác nhận chuyển
          </Button>
        ]}
      >
        <Spin spinning={loading}>
          <div className="pos-quick-transfer">
            <div className="pos-quick-transfer-route">
              <div><span>Chuyển từ</span><b>{source?.name ?? "Chưa xác định Quỹ quán"}</b>
                {source && <small>Số dư: {formatMoney(source.current_balance)} đ</small>}</div>
              <span aria-hidden="true">→</span>
              <div><span>Chuyển đến</span><b>{destination?.name ?? "Chưa có Quỹ đi chợ"}</b>
                {destination && <small>Số dư: {formatMoney(destination.current_balance)} đ</small>}</div>
            </div>
            {(!source || !destination) && !loading && (
              <div className="pos-quick-warning">Hãy kiểm tra Quỹ quán và Quỹ đi chợ (ID 3) đang hoạt động trên Web quản lý.</div>
            )}
            <label htmlFor="pos-market-transfer-amount">Số tiền chuyển (đ)</label>
            <InputNumber<number>
              id="pos-market-transfer-amount"
              autoFocus
              min={1} step={10000} precision={0}
              className="pos-quick-transfer-input"
              placeholder="Nhập số tiền"
              value={transferAmount}
              onChange={setTransferAmount}
              disabled={saving || loading}
            />
            <small>Giao dịch sẽ tự ghi phiếu chi ở Quỹ quán và phiếu thu ở Quỹ đi chợ.</small>
          </div>
        </Spin>
      </Modal>

      <Modal
        open={purchaseOpen}
        title="Nhập hàng nhanh"
        width={900}
        destroyOnClose
        maskClosable={!saving}
        closable={!saving}
        onCancel={() => { if (!saving) onClose(); }}
        className="pos-quick-purchase-modal"
        footer={[
          <span key="summary" className="pos-quick-footer-total">Tổng: {formatMoney(total)} đ</span>,
          <Button key="cancel" size="large" disabled={saving} onClick={onClose}>Đóng</Button>,
          <Button key="save" size="large" type="primary" loading={saving}
            disabled={loading || !paymentAccount} onClick={() => void submitPurchase()}>
            Lưu phiếu nhập
          </Button>
        ]}
      >
        <Spin spinning={loading}>
          <div className="pos-quick-purchase">
            <div className="pos-quick-purchase-top">
              <label>Nhà cung cấp
                <Select
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="Tìm nhà cung cấp..."
                  value={supplierId}
                  disabled={loading || saving}
                  onChange={setSupplierId}
                  options={activeSuppliers.map((supplier) => ({
                    value: supplier.id, label: supplier.name
                  }))}
                />
              </label>
              <div className="pos-quick-payment">
                <span>Thanh toán</span>
                <Select<number>
                  showSearch
                  optionFilterProp="label"
                  placeholder="Chọn quỹ / tài khoản thanh toán"
                  aria-label="Nguồn thanh toán phiếu nhập"
                  value={paymentFundAccountId}
                  onChange={setPaymentFundAccountId}
                  disabled={saving || loading || purchaseAccounts.length === 0}
                  options={[
                    {
                      label: "TIỀN MẶT",
                      options: purchaseAccounts.filter((account) => account.type === "CASH")
                        .map((account) => ({ value: account.id, label: account.name }))
                    },
                    {
                      label: "TÀI KHOẢN NGÂN HÀNG",
                      options: purchaseAccounts.filter((account) => account.type === "BANK")
                        .map((account) => ({ value: account.id, label: account.name }))
                    }
                  ]}
                />
              </div>
            </div>
            {!loading && !paymentAccount && (
              <div className="pos-quick-warning">Không có quỹ/tài khoản đang hoạt động. Hãy kiểm tra danh sách nguồn tiền trên Web quản lý.</div>
            )}
            {paymentAccount && (
              <div className="pos-quick-payment-balance">
                Số dư {paymentAccount.name}: {formatMoney(paymentAccount.current_balance)} đ
              </div>
            )}
            <div className="pos-quick-list-header">
              <b>Danh sách hàng nhập</b>
              <span>{lines.length} dòng</span>
            </div>
            <div className="pos-quick-lines">
              <div className="pos-quick-line pos-quick-line-heading">
                <span>Hàng hóa</span><span>ĐVT</span><span>SL</span>
                <span>Giá nhập (đ)</span><span>Thành tiền</span><span />
              </div>
              {lines.map((line, index) => {
                const item = items.find((row) => row.id === line.item_id);
                return (
                  <div className="pos-quick-line" key={line.key}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="Chọn hàng..."
                      className="pos-quick-line-item"
                      aria-label={"Hàng hóa dòng " + (index + 1)}
                      value={line.item_id}
                      disabled={loading || saving}
                      onChange={(value) => chooseItem(line.key, value)}
                      options={activeItems.map((row) => ({ value: row.id, label: row.name }))}
                    />
                    <Select
                      placeholder="ĐVT"
                      aria-label={"Đơn vị dòng " + (index + 1)}
                      value={line.unit_id}
                      disabled={!item || loading || saving}
                      onChange={(value) => chooseUnit(line, value)}
                      options={(item?.conversions ?? []).filter((unit) => unit.is_active)
                        .map((unit) => ({ value: unit.unit_id, label: unit.unit_name }))}
                    />
                    <InputNumber<number>
                      aria-label={"Số lượng dòng " + (index + 1)}
                      min={0.001} precision={3} step={1}
                      placeholder="SL"
                      value={line.quantity}
                      disabled={loading || saving}
                      onChange={(value) => updateLine(line.key, { quantity: value ?? undefined })}
                    />
                    <InputNumber<number>
                      aria-label={"Đơn giá dòng " + (index + 1)}
                      min={0} precision={0} step={1000}
                      placeholder="Giá nhập"
                      value={line.unit_price}
                      disabled={loading || saving}
                      onChange={(value) => updateLine(line.key, { unit_price: value ?? undefined })}
                    />
                    <strong>{formatMoney(roundLineTotal((line.quantity ?? 0) * (line.unit_price ?? 0)))} đ</strong>
                    <Button danger className="pos-quick-remove" aria-label={"Xóa dòng " + (index + 1)}
                      disabled={loading || saving}
                      onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}>
                      ×
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button type="dashed" className="pos-quick-add-line" disabled={loading || saving}
              onClick={() => setLines((current) => [...current, { key: ++nextLineId.current }])}>
              + Thêm hàng hóa
            </Button>
            <div className="pos-quick-note">Giá nhập và đơn vị tự điền theo lịch sử; có thể chỉnh trực tiếp. Phiếu lưu ngay lên máy tính, không cần đồng bộ như app Android.</div>
          </div>
        </Spin>
      </Modal>
    </>
  );
}
