import { useEffect, useMemo, useRef, useState } from "react";
import {
  AutoComplete,
  Button,
  Input,
  InputNumber,
  message,
  Modal,
  Select
} from "antd";

import {
  createSaleOrder,
  createPosCustomer,
  createSurchargePreset,
  getFundAccounts,
  getPosCustomers,
  getInstalledPrinters,
  getMenuItems,
  getRestaurantAreas,
  getRestaurantTables,
  getSaleOrder,
  getSaleOrders,
  getSurchargePresets,
  getPosSettings,
  paySaleOrder,
  printSaleOrderCancellation,
  printSaleOrderEstimate,
  printSaleOrderReceipt,
  sendSaleOrderToKitchen,
  testPosPrinter,
  updatePosSettings,
  updateSaleOrder,
  voidSaleOrder
} from "./api";
import type {
  FundAccount,
  FundAccountType,
  MenuItem,
  MenuItemOption,
  PosSettings,
  PosCustomer,
  PosCustomerInput,
  PrinterRole,
  PrinterTarget,
  RestaurantArea,
  RestaurantTable,
  SaleOrder,
  SaleOrderInput,
  SaleSurchargeInput,
  SurchargePreset
} from "./types";
import "./PosApp.css";
import PosDashboard from "./PosDashboard";
import PosQuickActions from "./PosQuickActions";
import type { PosQuickAction } from "./PosQuickActions";

type PosView = "DASHBOARD" | "MAP" | "ORDERS" | "SALE" | "CHECKOUT";

type CartLine = {
  key: string;
  menuItemId: number;
  optionId: number | null;
  name: string;
  optionName: string | null;
  unitPrice: number;
  quantity: number;
  note: string;
  surcharges: SaleSurchargeInput[];
};

const money = (value: number) =>
  new Intl.NumberFormat("vi-VN").format(Math.round(value));

function defaultPosition(index: number) {
  return {
    x: 4 + (index % 5) * 19,
    y: 6 + Math.floor(index / 5) * 19
  };
}

function tablePosition(table: RestaurantTable, index: number) {
  if (table.pos_x === 0 && table.pos_y === 0) return defaultPosition(index);
  return {
    x: Math.max(0, Math.min(84, table.pos_x)),
    y: Math.max(0, Math.min(84, table.pos_y))
  };
}

function rowTotal(line: CartLine): number {
  return (
    line.quantity * line.unitPrice +
    line.surcharges.reduce((total, extra) => total + extra.amount, 0)
  );
}

function timeSince(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "";
  const minutes = Math.floor(elapsed / 60_000);
  return minutes < 60
    ? `${minutes} phút`
    : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

let newLineSequence = 0;

export default function PosApp() {
  const [view, setView] = useState<PosView>("DASHBOARD");
  const [areas, setAreas] = useState<RestaurantArea[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [surchargePresets, setSurchargePresets] = useState<SurchargePreset[]>([]);
  const menuGridRef = useRef<HTMLDivElement | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickAction, setQuickAction] = useState<PosQuickAction>(null);
  const [dashboardRevision, setDashboardRevision] = useState(0);
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printerSaving, setPrinterSaving] = useState(false);
  const [printerTesting, setPrinterTesting] = useState<PrinterRole | null>(null);
  const [installedPrinters, setInstalledPrinters] = useState<string[]>([]);
  const [printerSettings, setPrinterSettings] = useState<PosSettings>({
    kitchen_printer_name: "",
    cashier_printer_name: "",
    send_kitchen_targets: "BOTH",
    print_receipt_targets: "CASHIER"
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingOrder, setEditingOrder] = useState<SaleOrder | null>(null);
  const [tableId, setTableId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [optionItem, setOptionItem] = useState<MenuItem | null>(null);
  const [noteLineKey, setNoteLineKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [kitchenNote, setKitchenNote] = useState("");
  const kitchenNoteDrafts = useRef<Map<number, string>>(new Map());
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const [surchargeLineKey, setSurchargeLineKey] = useState<string | null>(null);
  const [surchargePresetId, setSurchargePresetId] = useState<number | undefined>();
  const [surchargeName, setSurchargeName] = useState("");
  const [surchargeAmount, setSurchargeAmount] = useState(0);
  const [surchargeSaving, setSurchargeSaving] = useState(false);
  const [tableActions, setTableActions] = useState<RestaurantTable | null>(null);
  const [checkoutOrder, setCheckoutOrder] = useState<SaleOrder | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentStep, setPaymentStep] = useState<"CHOICE" | "CUSTOMER" | "METHOD" | "CONFIRM">("CHOICE");
  const [requestInvoice, setRequestInvoice] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "BANK" | "DEBT">("CASH");
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [customerId, setCustomerId] = useState<number>();
  const [customerCreating, setCustomerCreating] = useState(false);
  const [customerDraft, setCustomerDraft] = useState<PosCustomerInput>({
    customer_type: "PERSON", name: "", phone: null, tax_code: null,
    address: null, email: null, contact_name: null
  });
  const [paymentAccountType, setPaymentAccountType] = useState<FundAccountType>("CASH");
  const [paymentFundAccountId, setPaymentFundAccountId] = useState<number>();
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [messageApi, contextHolder] = message.useMessage();

  async function refresh() {
    const [areaRows, tableRows, openOrders] = await Promise.all([
      getRestaurantAreas(true),
      getRestaurantTables({ active_only: true }),
      getSaleOrders({ status: "OPEN" })
    ]);

    setAreas(areaRows);
    setTables(tableRows);
    setOrders(openOrders.filter((order) => order.order_type === "DINE_IN"));
    setSelectedAreaId((current) =>
      current !== null && areaRows.some((area) => area.id === current)
        ? current
        : areaRows[0]?.id ?? null
    );
  }

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const [menu, funds, presets] = await Promise.all([
          getMenuItems(), getFundAccounts(), getSurchargePresets()
        ]);
        if (cancelled) return;
        setMenuItems(menu.filter((item) => item.is_active));
        setAccounts(funds);
        setSurchargePresets(presets);
        await refresh();
      } catch (error) {
        if (!cancelled) {
          messageApi.error(
            error instanceof Error ? error.message : "Không tải được dữ liệu POS."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedArea =
    areas.find((area) => area.id === selectedAreaId) ?? null;
  const areaTables = tables
    .filter((table) => table.area_id === selectedAreaId)
    .sort(
      (a, b) => a.display_order - b.display_order || a.id - b.id
    );
  const emptyCount = tables.filter((table) => !table.open_order_id).length;
  const areaEmptyCount = areaTables.filter((table) => !table.open_order_id).length;

  const groups = useMemo(() => {
    const unique = new Map<number, string>();
    menuItems.forEach((item) => unique.set(item.menu_group_id, item.menu_group_name));
    return Array.from(unique, ([id, name]) => ({ id, name }));
  }, [menuItems]);

  const filteredMenu = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("vi");
    return menuItems.filter(
      (item) =>
        (groupId === null || item.menu_group_id === groupId) &&
        (!term || item.name.toLocaleLowerCase("vi").includes(term))
    );
  }, [menuItems, groupId, search]);

  const total = useMemo(
    () =>
      cart.reduce((sum, item) => sum + rowTotal(item), 0) +
      (editingOrder?.surcharges.reduce((sum, item) => sum + item.amount, 0) ?? 0),
    [cart, editingOrder]
  );

  const selectedTable = tables.find((table) => table.id === tableId);

  function changeKitchenNote(value: string) {
    setKitchenNote(value);
    if (tableId !== null) {
      if (value.trim()) kitchenNoteDrafts.current.set(tableId, value);
      else kitchenNoteDrafts.current.delete(tableId);
    }
  }

  function newOrder(table: RestaurantTable) {
    setEditingOrder(null);
    setTableId(table.id);
    setCart([]);
    setKitchenNote(kitchenNoteDrafts.current.get(table.id) ?? "");
    setSelectedLineKey(null);
    setDirty(false);
    setSearch("");
    setGroupId(null);
    setView("SALE");
  }

  async function openExisting(orderId: number) {
    setBusy(true);
    try {
      const order = await getSaleOrder(orderId);
      if (order.status !== "OPEN" || order.order_type !== "DINE_IN") {
        messageApi.warning("Order này không còn đang phục vụ.");
        await refresh();
        return;
      }
      // Keep the entire existing order, including notes and surcharges, on edit.
      if (order.items.some((item) => item.menu_item_id === null)) {
        messageApi.warning("Order có món ngoài thực đơn, hãy sửa trên Web quản lý.");
        return;
      }

      setEditingOrder(order);
      setTableId(order.table_id);
      setCart(
        order.items.map((item) => ({
          key: `saved-${item.id}`,
          menuItemId: item.menu_item_id as number,
          optionId: item.menu_item_option_id,
          name: item.item_name_snapshot,
          optionName: item.option_name_snapshot,
          unitPrice: item.unit_price,
          quantity: item.quantity,
          note: item.note ?? "",
          surcharges: item.surcharges.map((extra) => ({
            name: extra.name,
            amount: extra.amount
          }))
        }))
      );
      setKitchenNote(order.table_id === null ? "" : kitchenNoteDrafts.current.get(order.table_id) ?? "");
      setSelectedLineKey(null);
      setDirty(false);
      setSearch("");
      setGroupId(null);
      setView("SALE");
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không mở được Order."
      );
    } finally {
      setBusy(false);
    }
  }

  function openTable(table: RestaurantTable) {
    if (busy) return;
    if (table.open_order_id !== null) {
      setTableActions(table);
    } else {
      newOrder(table);
    }
  }

  function addItem(item: MenuItem, option: MenuItemOption | null = null) {
    const optionId = option?.id ?? null;
    const unitPrice = option?.sale_price ?? item.base_price;
    setCart((current) => {
      // Only merge identical plain lines. Keep annotated lines independent.
      const identical = current.find(
        (line) =>
          line.menuItemId === item.id &&
          line.optionId === optionId &&
          !line.note &&
          line.surcharges.length === 0
      );
      if (identical) {
        return current.map((line) =>
          line.key === identical.key
            ? { ...line, quantity: line.quantity + 1 }
            : line
        );
      }
      newLineSequence += 1;
      return [
        ...current,
        {
          key: `new-${newLineSequence}`,
          menuItemId: item.id,
          optionId,
          name: item.name,
          optionName: option?.service_option_name ?? null,
          unitPrice,
          quantity: 1,
          note: "",
          surcharges: []
        }
      ];
    });
    setDirty(true);
    setOptionItem(null);
  }

  function selectMenuItem(item: MenuItem) {
    const options = item.options.filter((option) => option.is_active);
    if (options.length) {
      setOptionItem(item);
    } else {
      addItem(item);
    }
  }

  function updateQuantity(key: string, quantity: number) {
    if (!Number.isFinite(quantity)) return;
    setCart((current) =>
      quantity <= 0
        ? current.filter((line) => line.key !== key)
        : current.map((line) =>
            line.key === key ? { ...line, quantity } : line
          )
    );
    if (quantity <= 0) setSelectedLineKey((current) => current === key ? null : current);
    setDirty(true);
  }

  function backToMap() {
    if (dirty) {
      Modal.confirm({
        title: "Chưa lưu thay đổi",
        content: "Những thay đổi trong Order chưa được lưu. Bạn muốn bỏ thay đổi?",
        okText: "Bỏ thay đổi",
        okButtonProps: { danger: true },
        cancelText: "Ở lại",
        onOk: () => {
          setDirty(false);
          setView("MAP");
          void refresh();
        }
      });
      return;
    }
    setView("MAP");
    void refresh();
  }

  function openSurcharge(key: string) {
    setSurchargeLineKey(key);
    setSurchargePresetId(undefined);
    setSurchargeName("");
    setSurchargeAmount(0);
  }

  async function addLineSurcharge() {
    const name = surchargeName.trim();
    const amount = Math.round(Number(surchargeAmount));
    if (!surchargeLineKey || !cart.some((line) => line.key === surchargeLineKey)) {
      messageApi.warning("Món này không còn trong Order.");
      return;
    }
    if (!name || name.length > 120 || !Number.isFinite(amount) || amount <= 0) {
      messageApi.warning("Nhập tên phụ thu và số tiền lớn hơn 0.");
      return;
    }
    setSurchargeSaving(true);
    try {
      const known = surchargePresets.some(
        (preset) => preset.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi")
      );
      if (!known) {
        const preset = await createSurchargePreset({ name, amount });
        setSurchargePresets((current) => [...current, preset].sort(
          (a, b) => a.name.localeCompare(b.name, "vi")
        ));
      }
      setCart((current) => current.map((line) => line.key === surchargeLineKey
        ? { ...line, surcharges: [...line.surcharges, { name, amount }] }
        : line
      ));
      setDirty(true);
      setSurchargeLineKey(null);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không lưu được phụ thu.");
    } finally {
      setSurchargeSaving(false);
    }
  }

  function removeLineSurcharge(key: string, index: number) {
    setCart((current) => current.map((line) => line.key === key
      ? { ...line, surcharges: line.surcharges.filter((_, i) => i !== index) }
      : line
    ));
    setDirty(true);
  }

  // Save before kitchen / payment so the backend receives the latest detail.
  async function saveOrder(returnToMap = true): Promise<SaleOrder | null> {
    if (busy) return null;
    if (tableId === null) {
      messageApi.error("Chưa chọn bàn.");
      return null;
    }
    if (!cart.length) {
      messageApi.warning("Chọn ít nhất một món trước khi lưu Order.");
      return null;
    }
    if (cart.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      messageApi.warning("Số lượng món phải lớn hơn 0.");
      return null;
    }
    if (editingOrder && !dirty) {
      if (returnToMap) {
        setView("MAP");
        await refresh().catch(() => messageApi.warning("Không tải lại được sơ đồ."));
      }
      return editingOrder;
    }

    const payload: SaleOrderInput = {
      order_type: "DINE_IN",
      table_id: tableId,
      guest_count: editingOrder?.guest_count ?? 0,
      customer_id: editingOrder?.customer_id ?? null,
      note: editingOrder?.note ?? null,
      payment_status: "DEBT", // compatibility with old installed POS
      settlement_target: "OPEN", // saving an order never creates a debt
      items: cart.map((line) => ({
        menu_item_id: line.menuItemId,
        menu_item_option_id: line.optionId,
        quantity: line.quantity,
        note: line.note || null,
        surcharges: line.surcharges
      })),
      surcharges: editingOrder?.surcharges.map((extra) => ({
        name: extra.name,
        amount: extra.amount
      })) ?? []
    };

    setBusy(true);
    try {
      const saved = editingOrder
        ? await updateSaleOrder(editingOrder.id, payload)
        : await createSaleOrder(payload);
      setDirty(false);
      setEditingOrder(saved);
      if (returnToMap) setView("MAP");
      messageApi.success(`Đã lưu ${saved.order_code}.`);
      await refresh().catch(() => messageApi.warning(
        "Order đã lưu nhưng chưa tải lại được sơ đồ."
      ));
      return saved;
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không lưu được Order.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openPrinterConfig() {
    setMenuOpen(false);
    setPrinterModalOpen(true);
    setPrinterLoading(true);
    try {
      const [settings, printers] = await Promise.all([
        getPosSettings(), getInstalledPrinters()
      ]);
      setPrinterSettings(settings);
      setInstalledPrinters(printers);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không đọc được cấu hình máy in.");
    } finally {
      setPrinterLoading(false);
    }
  }

  async function savePrinterConfig() {
    setPrinterSaving(true);
    try {
      const saved = await updatePosSettings(printerSettings);
      setPrinterSettings(saved);
      messageApi.success("Đã lưu cấu hình máy in cho cả hai chức năng.");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không lưu được máy in.");
    } finally {
      setPrinterSaving(false);
    }
  }

  async function testPrinter(role: PrinterRole) {
    setPrinterTesting(role);
    try {
      const result = await testPosPrinter(role);
      if (result.ok) {
        messageApi.success("Đã gửi phiếu in thử đến " + (result.printer_name ?? "máy in") + ".");
      } else {
        messageApi.error(result.error ?? "Máy in thử không thành công.");
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không in thử được.");
    } finally {
      setPrinterTesting(null);
    }
  }

  async function performSendKitchen() {
    const saved = await saveOrder(false);
    if (!saved) return;
    setBusy(true);
    const noteForThisPrint = kitchenNote;
    try {
      const ticket = await sendSaleOrderToKitchen(saved.id, noteForThisPrint);
      if (ticket.print_status === "NO_NEW_ITEMS") {
        messageApi.info("Không có món mới cần gửi bếp.");
        return;
      }
      if (ticket.print_status !== "PRINTED") {
        messageApi.error(
          "Order đã lưu nhưng chưa in đủ phiếu: " +
          (ticket.error_message || "Kiểm tra cấu hình máy in.")
        );
        return;
      }
      setKitchenNote("");
      if (saved.table_id !== null) {
        kitchenNoteDrafts.current.delete(saved.table_id);
      }
      setEditingOrder({ ...saved, kitchen_sent_at: ticket.sent_at });
      messageApi.success("Đã gửi bếp " + saved.order_code + ".");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không gửi được bếp.");
    } finally {
      setBusy(false);
    }
  }

  function sendKitchen() {
    if (!busy) void performSendKitchen();
  }

  async function tryPrintPaidReceipt(orderId: number) {
    let failure: string | null = null;
    try {
      const result = await printSaleOrderReceipt(orderId);
      if (result.print_status === "PRINTED") {
        messageApi.success("Đã in phiếu thanh toán.");
        return;
      }
      failure = result.error_message ?? "Một số máy in không nhận được phiếu.";
    } catch (error) {
      failure = error instanceof Error ? error.message : "Lỗi in phiếu thanh toán.";
    }
    // Never attempt payment again when only the printer failed.
    Modal.confirm({
      title: "Đơn đã thanh toán, nhưng in phiếu chưa thành công",
      content: failure,
      okText: "Thử in lại",
      cancelText: "Để sau",
      onOk: () => tryPrintPaidReceipt(orderId)
    });
  }

  async function startCheckout(orderId: number) {
    if (busy) return;
    setBusy(true);
    try {
      const order = await getSaleOrder(orderId);
      if (order.status !== "OPEN" || order.order_type !== "DINE_IN") {
        messageApi.warning("Order không còn đang phục vụ.");
        await refresh();
        return;
      }
      setTableActions(null);
      setCheckoutOrder(order);
      setView("CHECKOUT");
      setDirty(false);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không mở được thanh toán.");
    } finally {
      setBusy(false);
    }
  }

  async function checkoutFromSale() {
    const saved = await saveOrder(false);
    if (!saved) return;
    await startCheckout(saved.id);
  }

  async function tryPrintCancelSlip(orderId: number) {
    try {
      const printed = await printSaleOrderCancellation(orderId);
      if (printed.print_status === "PRINTED") {
        messageApi.success("Đã in phiếu hủy ở máy bếp.");
        return;
      }
      throw new Error(printed.error_message || "Máy bếp chưa nhận được phiếu hủy.");
    } catch (error) {
      Modal.confirm({
        title: "Order đã hủy, nhưng phiếu hủy bếp chưa được in",
        content: error instanceof Error ? error.message : "Kiểm tra máy in bếp.",
        okText: "Thử in lại",
        cancelText: "Để sau",
        onOk: () => tryPrintCancelSlip(orderId)
      });
    }
  }

  async function printEstimate() {
    if (!checkoutOrder || busy) return;
    setBusy(true);
    try {
      const printed = await printSaleOrderEstimate(checkoutOrder.id);
      if (printed.print_status === "PRINTED")
        messageApi.success("Đã in phiếu tạm tính ở máy thu ngân.");
      else messageApi.error(printed.error_message || "Không in được phiếu tạm tính.");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không in được tạm tính.");
    } finally {
      setBusy(false);
    }
  }

  function confirmCancelOrder(order: SaleOrder | null | undefined) {
    if (!order || busy) return;
    let reason = "Khách hủy Order";
    Modal.confirm({
      title: `Hủy toàn bộ ${order.order_code}?`,
      content: (
        <div className="pos-cancel-form">
          <p>Order {order.table_name ?? ""} sẽ được lưu lịch sử hủy; bàn trở về trạng thái trống.</p>
          <label>Lý do hủy</label>
          <Input.TextArea defaultValue={reason} maxLength={200}
            onChange={(event) => { reason = event.target.value; }} />
          {order.kitchen_sent_at && <p className="pos-warning">
            Đơn đã gửi bếp. Hệ thống sẽ in phiếu hủy ở máy bếp.
          </p>}
        </div>
      ),
      okText: "Xác nhận hủy",
      okButtonProps: { danger: true },
      cancelText: "Không hủy",
      onOk: async () => {
        if (!reason.trim()) { messageApi.warning("Nhập lý do hủy."); throw new Error("Missing reason"); }
        setBusy(true);
        try {
          const canceled = await voidSaleOrder(order.id, reason.trim());
          setTableActions(null);
          setCheckoutOrder(null);
          setEditingOrder(null);
          setTableId(null);
          setCart([]);
          setDirty(false);
          setView("MAP");
          if (canceled.table_id !== null) kitchenNoteDrafts.current.delete(canceled.table_id);
          setKitchenNote("");
          await refresh().catch(() =>
            messageApi.warning("Đã hủy Order nhưng chưa cập nhật được sơ đồ."));
          messageApi.success(`Đã hủy ${canceled.order_code} và giải phóng bàn.`);
          if (canceled.kitchen_sent_at) {
            await tryPrintCancelSlip(canceled.id);
          }
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : "Không hủy được Order.");
          throw error;
        } finally {
          setBusy(false);
        }
      }
    });
  }

  async function loadCustomers(query = "") {
    try { setCustomers(await getPosCustomers(query)); }
    catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không tải được khách hàng.");
    }
  }

  function choosePayment(method: "CASH" | "BANK" | "DEBT", invoice = false) {
    setRequestInvoice(invoice);
    setPaymentMethod(method);
    if (method !== "DEBT") {
      setPaymentAccountType(method);
      const matching = accounts.filter((account) =>
        account.is_active && account.type === method
      );
      setPaymentFundAccountId(
        (matching.find((account) => account.is_default) ?? matching[0])?.id
      );
    } else {
      setPaymentFundAccountId(undefined);
    }
    setPaymentStep(method === "DEBT" && !invoice ? "CUSTOMER" : "CONFIRM");
  }

  function openPayment() {
    if (!checkoutOrder || busy) return;
    setPaymentOpen(true);
    setPaymentStep("CHOICE");
    setRequestInvoice(false);
    setCustomerCreating(false);
    setCustomerId(checkoutOrder.customer_id ?? undefined);
    setPaymentAmount(checkoutOrder.total_amount);
    void loadCustomers();
  }

  async function saveCustomer() {
    if (!customerDraft.name.trim()) {
      messageApi.warning("Nhập tên khách hàng.");
      return;
    }
    if (customerDraft.tax_code?.trim() && !customerDraft.address?.trim()) {
      messageApi.warning("Khách có mã số thuế cần nhập địa chỉ.");
      return;
    }
    setBusy(true);
    try {
      const saved = await createPosCustomer(customerDraft);
      setCustomers((current) => [saved, ...current]);
      setCustomerId(saved.id);
      setCustomerCreating(false);
      setCustomerDraft({
        customer_type: "PERSON", name: "", phone: null, tax_code: null,
        address: null, email: null, contact_name: null
      });
      messageApi.success("Đã thêm khách hàng.");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không tạo được khách hàng.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPayment() {
    if (!checkoutOrder || busy) return;
    if ((requestInvoice || paymentMethod === "DEBT") && !customerId) {
      messageApi.warning("Chọn khách hàng trước khi xác nhận.");
      return;
    }
    if (paymentMethod !== "DEBT" && !paymentFundAccountId) {
      messageApi.warning("Chọn quỹ hoặc tài khoản nhận tiền.");
      return;
    }
    if (paymentMethod !== "DEBT" &&
      (!Number.isFinite(paymentAmount) ||
        (checkoutOrder.total_amount > 0 && paymentAmount <= 0))) {
      messageApi.warning("Tiền thực thu phải lớn hơn 0.");
      return;
    }
    setBusy(true);
    try {
      const paid = await paySaleOrder(checkoutOrder.id, {
        payment_method: paymentMethod,
        expected_total_amount: checkoutOrder.total_amount,
        fund_account_id: paymentMethod === "DEBT" ? null : paymentFundAccountId,
        actual_received_amount: paymentMethod === "DEBT" ? null : Math.round(paymentAmount),
        customer_id: customerId ?? null,
        request_einvoice: requestInvoice
      });
      setPaymentOpen(false);
      if (paid.table_id !== null) kitchenNoteDrafts.current.delete(paid.table_id);
      setKitchenNote("");
      setTableActions(null);
      setCheckoutOrder(null);
      setEditingOrder(null);
      setCart([]);
      setTableId(null);
      setSelectedLineKey(null);
      setDirty(false);
      setView("MAP");
      messageApi.success(paymentMethod === "DEBT"
        ? `Đã ghi nợ ${paid.order_code}; bàn đã được giải phóng.`
        : `Đã thanh toán ${paid.order_code} và ghi vào quỹ.`);
      if (requestInvoice)
        messageApi.info("Đã lưu yêu cầu HĐĐT. Phát hành thủ công sau trên Web quản lý.");
      await refresh().catch(() => messageApi.warning(
        "Đơn đã kết thúc nhưng chưa cập nhật được sơ đồ."
      ));
      if (paymentMethod !== "DEBT") await tryPrintPaidReceipt(paid.id);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Thanh toán thất bại.");
    } finally {
      setBusy(false);
    }
  }

  function setViewSafely(next: "DASHBOARD" | "MAP" | "ORDERS") {
    if (view === "SALE" && dirty) {
      Modal.confirm({
        title: "Order chưa được lưu",
        content: "Bạn muốn bỏ các thay đổi và rời Order?",
        okText: "Rời Order",
        okButtonProps: { danger: true },
        cancelText: "Ở lại",
        onOk: () => {
          setDirty(false);
          setView(next);
          void refresh();
        }
      });
    } else {
      setView(next);
      void refresh();
    }
  }

  return (
    <div
      className="oc11-pos"
      onClick={() => menuOpen && setMenuOpen(false)}
    >
      {contextHolder}
      <header className="pos-topbar">
        <button
          className="pos-home"
          type="button"
          onClick={() => setViewSafely("DASHBOARD")}
          aria-label="Trang chủ"
        >
          ⌂
        </button>
        <button
          type="button"
          className={view === "DASHBOARD" ? "active" : ""}
          onClick={() => setViewSafely("DASHBOARD")}
        >
          ◫ Tổng quan
        </button>
        <button
          type="button"
          className={view === "ORDERS" ? "active" : ""}
          onClick={() => setViewSafely("ORDERS")}
        >
          🧾 Order
        </button>
        <button
          type="button"
          className={view === "MAP" ? "active" : ""}
          onClick={() => setViewSafely("MAP")}
        >
          ▥ Sơ đồ
        </button>
        <div className="pos-topbar-spacer" />
        <div
          className="pos-menu-wrap"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="pos-menu-button"
            aria-label="Menu"
            onClick={() => setMenuOpen((current) => !current)}
          >
            ☰
          </button>
          {menuOpen && (
            <div className="pos-menu-popup">
              <button type="button" onClick={() => {
                setMenuOpen(false);
                setQuickAction("TRANSFER");
              }}>
                ↗ Chuyển tiền đi chợ
              </button>
              <button type="button" onClick={() => {
                setMenuOpen(false);
                setQuickAction("PURCHASE");
              }}>
                ＋ Nhập hàng nhanh
              </button>
              <button type="button" onClick={() => void openPrinterConfig()}>
                ⚙ Cài đặt máy in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  window.open("/", "_blank", "noopener,noreferrer");
                }}
              >
                Đến Web quản lý
              </button>
            </div>
          )}
        </div>
      </header>

      {view === "DASHBOARD" && <PosDashboard key={dashboardRevision} />}

      {view === "MAP" && (
        <main className="pos-map-view">
          <div className="pos-map-summary">
            <strong>Toàn bộ nhà hàng:</strong>
            <span>Trống {emptyCount}/{tables.length} bàn</span>
            {selectedArea && (
              <>
                <span className="pos-map-chevron">›</span>
                <strong>{selectedArea.name}:</strong>
                <span>Trống {areaEmptyCount}/{areaTables.length} bàn</span>
              </>
            )}
            <button
              type="button"
              className="pos-refresh"
              onClick={() => void refresh().catch((error) =>
                messageApi.error(
                  error instanceof Error ? error.message : "Không làm mới được sơ đồ."
                )
              )}
            >
              ↻ Làm mới
            </button>
            <span className="pos-legend pos-legend-first">
              <i className="empty" /> Bàn trống
            </span>
            <span className="pos-legend">
              <i className="busy" /> Bàn đang phục vụ
            </span>
          </div>
          <div className="pos-map-body">
            <aside className="pos-area-list">
              {areas.map((area) => {
                const rows = tables.filter((table) => table.area_id === area.id);
                const empty = rows.filter((table) => !table.open_order_id).length;
                return (
                  <button
                    key={area.id}
                    type="button"
                    className={selectedAreaId === area.id ? "active" : ""}
                    onClick={() => setSelectedAreaId(area.id)}
                  >
                    <b>{area.name} ({rows.length})</b>
                    <span>{empty}/{rows.length} trống</span>
                  </button>
                );
              })}
              {!loading && areas.length === 0 && (
                <div className="pos-empty">
                  Chưa có khu vực. Thêm khu vực và bàn trong Web quản lý → Cài đặt.
                </div>
              )}
            </aside>
            <section className="pos-table-map">
              {areaTables.map((table, index) => {
                const position = tablePosition(table, index);
                return (
                  <button
                    key={table.id}
                    type="button"
                    disabled={busy}
                    className={`pos-table ${table.open_order_id ? "busy" : "empty"}`}
                    style={{ left: `${position.x}%`, top: `${position.y}%` }}
                    onClick={() => openTable(table)}
                  >
                    <span className="table-icon">▣</span>
                    <strong>{table.name}</strong>
                    {table.open_order_id !== null && (
                      <>
                        <small>{money(table.open_order_total ?? 0)} đ</small>
                        <small>Đang phục vụ</small>
                      </>
                    )}
                  </button>
                );
              })}
              {!loading && selectedArea && areaTables.length === 0 && (
                <div className="pos-empty">Khu vực này chưa có bàn.</div>
              )}
              {loading && <div className="pos-empty">Đang tải sơ đồ bàn...</div>}
            </section>
          </div>
        </main>
      )}

      {view === "ORDERS" && (
        <main className="pos-order-view">
          <div className="pos-order-toolbar">
            <b>Chờ thanh toán ({orders.length})</b>
            <Button onClick={() => void refresh()}>Làm mới</Button>
          </div>
          <div className="pos-active-orders">
            {orders.map((order) => (
              <button
                key={order.id}
                type="button"
                disabled={busy}
                className="pos-active-order-card"
                onClick={() => void openExisting(order.id)}
              >
                <div>
                  <strong>{order.area_name} · {order.table_name}</strong>
                  <span>{order.order_code}</span>
                </div>
                <div className="pos-active-order-total">
                  <b>{money(order.total_amount)} đ</b>
                  <span>{timeSince(order.order_time)}</span>
                </div>
              </button>
            ))}
            {!orders.length && (
              <div className="pos-empty">
                Chưa có Order nào. Vào Sơ đồ và chọn bàn trống để tạo Order.
              </div>
            )}
          </div>
        </main>
      )}

      {view === "SALE" && (
        <main className="pos-sale-view">
          <section className="pos-menu-side">
            <div className="pos-group-tabs">
              <button
                className={groupId === null ? "active" : ""}
                onClick={() => setGroupId(null)}
              >
                Tất cả
              </button>
              {groups.map((group) => (
                <button
                  key={group.id}
                  className={groupId === group.id ? "active" : ""}
                  onClick={() => setGroupId(group.id)}
                >
                  {group.name}
                </button>
              ))}
            </div>
            <div className="pos-search">
              <Input
                allowClear
                placeholder="Tìm món trong thực đơn..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="pos-menu-grid" ref={menuGridRef}>
              {filteredMenu.map((item) => {
                const activeOptions = item.options.filter((option) => option.is_active);
                return (
                  <button
                    type="button"
                    key={item.id}
                    className="pos-menu-item"
                    onClick={() => selectMenuItem(item)}
                  >
                    <span className="item-price">
                      {activeOptions.length
                        ? `Từ ${money(Math.min(...activeOptions.map((option) => option.sale_price)))}`
                        : money(item.base_price)}
                    </span>
                    <strong>{item.name}</strong>
                  </button>
                );
              })}
              {!filteredMenu.length && (
                <div className="pos-empty">Không có món phù hợp.</div>
              )}
            </div>
            <div className="pos-menu-scroll-controls">
              <button type="button" aria-label="Cuộn danh sách món lên"
                onClick={() => menuGridRef.current?.scrollBy({ top: -320, behavior: "smooth" })}>
                ▲ Lên
              </button>
              <button type="button" aria-label="Cuộn danh sách món xuống"
                onClick={() => menuGridRef.current?.scrollBy({ top: 320, behavior: "smooth" })}>
                ▼ Xuống
              </button>
            </div>
          </section>

          <section className="pos-cart-side">
            <div className="pos-cart-head">
              <div>
                <strong>
                  {selectedTable
                    ? `${selectedTable.area_name} · ${selectedTable.name}`
                    : "Chọn bàn"}
                </strong>
                <small>
                  {editingOrder
                    ? `${editingOrder.order_code} · Đang phục vụ`
                    : "Order mới"}
                </small>
              </div>
              <span className="pos-cart-status">Chưa thanh toán</span>
            </div>
            <div className="pos-cart-columns">
              <b>Tên món</b>
              <b>SL</b>
              <b>Thành tiền</b>
            </div>
            <div className="pos-cart-lines">
              {cart.map((line) => {
                const expanded = selectedLineKey === line.key;
                return (
                  <div className={`pos-cart-line${expanded ? " expanded" : ""}`} key={line.key}>
                    <div className="pos-line-name">
                      <button
                        type="button"
                        className="pos-line-toggle"
                        aria-expanded={expanded}
                        onClick={() => setSelectedLineKey((current) =>
                          current === line.key ? null : line.key
                        )}
                      >
                        <strong>{line.name}</strong>
                        {line.optionName && <em>+ {line.optionName}</em>}
                      </button>
                      {expanded && (
                        <div className="pos-line-details">
                          {line.surcharges.map((extra, index) => (
                            <div className="pos-line-extra" key={index}>
                              <span>+ {extra.name}: {money(extra.amount)} đ</span>
                              <button
                                type="button"
                                aria-label={`Bỏ phụ thu ${extra.name}`}
                                onClick={() => removeLineSurcharge(line.key, index)}
                              >×</button>
                            </div>
                          ))}
                          {line.note && <small className="pos-line-note">{line.note}</small>}
                          <div className="pos-line-tools">
                            <button type="button" onClick={() => openSurcharge(line.key)}>
                              + Phụ thu
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setNoteLineKey(line.key);
                                setNoteDraft(line.note);
                              }}
                            >
                              {line.note ? "Sửa ghi chú" : "+ Ghi chú"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="pos-line-qty">
                      <button type="button" aria-label="Giảm số lượng"
                        onClick={() => updateQuantity(line.key, line.quantity - 1)}>−</button>
                      <InputNumber<number> min={0.01} step={1} value={line.quantity}
                        onChange={(value) => {
                          if (value !== null) updateQuantity(line.key, value);
                        }}
                      />
                      <button type="button" aria-label="Tăng số lượng"
                        onClick={() => updateQuantity(line.key, line.quantity + 1)}>+</button>
                    </div>
                    <strong>{money(rowTotal(line))}</strong>
                    <button type="button" className="pos-line-remove" title="Bỏ món"
                      onClick={() => updateQuantity(line.key, 0)}>×</button>
                  </div>
                );
              })}
              {!cart.length && (
                <div className="pos-empty">
                  Chọn món ở phần thực đơn bên trái để lập Order.
                </div>
              )}
            </div>
            <div className="pos-cart-bottom">
              <div className="pos-kitchen-note">
                <label htmlFor="pos-kitchen-note">Ghi chú gửi bếp (không lưu vào đơn)</label>
                <Input.TextArea
                  id="pos-kitchen-note"
                  value={kitchenNote}
                  maxLength={500}
                  autoSize={{ minRows: 1, maxRows: 2 }}
                  onChange={(event) => changeKitchenNote(event.target.value)}
                  placeholder="Ví dụ: bàn cần ra đồ cùng lúc..."
                />
              </div>
              <div className="pos-total">
                <span>Tổng tiền</span>
                <strong>{money(total)} đ</strong>
              </div>
              <div className="pos-create-actions">
                <Button className="pos-kitchen-button" disabled={busy || !cart.length}
                  loading={busy} onClick={sendKitchen}>Gửi bếp</Button>
                <Button danger disabled={busy} onClick={backToMap}>Huỷ</Button>
                <Button className="pos-save-order" disabled={!cart.length} loading={busy}
                  onClick={() => void saveOrder()}>Lưu</Button>
                <Button className="pos-pay-button" type="primary" disabled={!cart.length || busy}
                  onClick={() => void checkoutFromSale()}>Tính tiền</Button>
              </div>
            </div>
          </section>
        </main>
      )}

      <Modal
        open={optionItem !== null}
        title={optionItem ? `Chọn kiểu chế biến · ${optionItem.name}` : ""}
        width={740}
        footer={null}
        onCancel={() => setOptionItem(null)}
        destroyOnClose
      >
        <div className="pos-option-list">
          {optionItem?.options
            .filter((option) => option.is_active)
            .map((option) => (
              <button
                type="button"
                className="pos-option-button"
                key={option.id}
                onClick={() => addItem(optionItem, option)}
              >
                <span className="pos-option-name">{option.service_option_name}</span>
                <strong className="pos-option-price">{money(option.sale_price)} đ</strong>
              </button>
            ))}
        </div>
      </Modal>

      <Modal
        open={noteLineKey !== null}
        title="Ghi chú món"
        okText="Xong"
        cancelText="Hủy"
        onCancel={() => setNoteLineKey(null)}
        onOk={() => {
          setCart((current) =>
            current.map((line) =>
              line.key === noteLineKey
                ? { ...line, note: noteDraft.trim() }
                : line
            )
          );
          setDirty(true);
          setNoteLineKey(null);
        }}
      >
        <Input.TextArea
          rows={3}
          maxLength={300}
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="Ví dụ: ít cay, không hành..."
        />
      </Modal>

      <Modal
        open={surchargeLineKey !== null}
        title="Phụ thu theo món"
        okText="Thêm phụ thu"
        okButtonProps={{ loading: surchargeSaving }}
        cancelText="Đóng"
        onCancel={() => { if (!surchargeSaving) setSurchargeLineKey(null); }}
        onOk={() => void addLineSurcharge()}
        destroyOnClose
      >
        <div className="pos-surcharge-form">
          <label>Phụ thu đã sử dụng</label>
          <Select
            allowClear
            placeholder="Chọn phụ thu cũ hoặc nhập mới"
            value={surchargePresetId}
            onChange={(value: number | undefined) => {
              setSurchargePresetId(value);
              const preset = surchargePresets.find((item) => item.id === value);
              if (preset) {
                setSurchargeName(preset.name);
                setSurchargeAmount(preset.amount);
              }
            }}
            options={surchargePresets.map((preset) => ({
              value: preset.id, label: `${preset.name} – ${money(preset.amount)} đ`
            }))}
          />
          <label>Tên phụ thu</label>
          <Input
            value={surchargeName}
            maxLength={120}
            placeholder="Ví dụ: Thêm sốt, thêm phô mai..."
            onChange={(event) => {
              setSurchargePresetId(undefined);
              setSurchargeName(event.target.value);
            }}
          />
          <label>Số tiền (đ)</label>
          <InputNumber<number>
            min={1}
            step={1000}
            precision={0}
            value={surchargeAmount}
            onChange={(value) => setSurchargeAmount(Number(value ?? 0))}
            style={{ width: "100%" }}
          />
        </div>
      </Modal>

      <PosQuickActions
        action={quickAction}
        onClose={() => setQuickAction(null)}
        onSaved={async () => {
          const funds = await getFundAccounts();
          setAccounts(funds);
          setDashboardRevision((current) => current + 1);
        }}
      />

      <Modal
        open={printerModalOpen}
        title="Cài đặt máy in POS"
        width={550}
        onCancel={() => { if (!printerSaving) setPrinterModalOpen(false); }}
        footer={[
          <Button key="close" onClick={() => setPrinterModalOpen(false)} disabled={printerSaving}>
            Đóng
          </Button>,
          <Button key="save" type="primary" loading={printerSaving}
            disabled={printerLoading} onClick={() => void savePrinterConfig()}>
            Lưu cấu hình
          </Button>
        ]}
      >
        <div className="pos-printer-settings">
          <div className="pos-printer-info">Chọn máy in đã cài trên Windows hoặc gõ tên máy in.
            Lưu cấu hình trước khi in thử.</div>
          <label>Máy in bếp</label>
          <div className="pos-printer-picker">
            <AutoComplete
              value={printerSettings.kitchen_printer_name}
              disabled={printerLoading}
              onChange={(name) => setPrinterSettings((current) =>
                ({ ...current, kitchen_printer_name: name }))}
              options={installedPrinters.map((name) => ({ value: name }))}
              placeholder="Chọn hoặc nhập tên máy in bếp"
              allowClear
            />
            <Button onClick={() => void testPrinter("KITCHEN")}
              loading={printerTesting === "KITCHEN"} disabled={printerLoading || printerSaving}>
              In thử
            </Button>
          </div>
          <label>Máy in thu ngân</label>
          <div className="pos-printer-picker">
            <AutoComplete
              value={printerSettings.cashier_printer_name}
              disabled={printerLoading}
              onChange={(name) => setPrinterSettings((current) =>
                ({ ...current, cashier_printer_name: name }))}
              options={installedPrinters.map((name) => ({ value: name }))}
              placeholder="Chọn hoặc nhập tên máy in thu ngân"
              allowClear
            />
            <Button onClick={() => void testPrinter("CASHIER")}
              loading={printerTesting === "CASHIER"} disabled={printerLoading || printerSaving}>
              In thử
            </Button>
          </div>
          <div className="pos-printer-info">
            Gửi bếp luôn in 2 phiếu 80 mm: chế biến ở máy bếp và kiểm đồ
            (có ô tick) ở máy thu ngân. Mỗi lần chỉ in món mới.
            Nếu lỗi sẽ chỉ in bù tại máy chưa in thành công.
          </div>
          <label>Chức năng In phiếu thanh toán in tại</label>
          <Select
            value={printerSettings.print_receipt_targets}
            disabled={printerLoading}
            onChange={(value: PrinterTarget) => setPrinterSettings((current) =>
              ({ ...current, print_receipt_targets: value }))}
            options={[
              { value: "CASHIER", label: "Chỉ máy in thu ngân" },
              { value: "KITCHEN", label: "Chỉ máy in bếp" },
              { value: "BOTH", label: "Cả hai máy" }
            ]}
          />
          <div className="pos-printer-info">Phiếu thanh toán tự in khi xác nhận Tính tiền.
            Nếu in lỗi, đơn vẫn được thanh toán và có thể chọn in lại.</div>
        </div>
      </Modal>

      <Modal
        open={tableActions !== null}
        title={`Bàn ${tableActions?.name ?? ""} · Đang phục vụ`}
        onCancel={() => setTableActions(null)}
        footer={null}
        destroyOnClose
      >
        <div className="pos-table-actions">
          <strong>{money(tableActions?.open_order_total ?? 0)} đ</strong>
          <Button block className="pos-table-actions-continue" onClick={() => {
            const id = tableActions?.open_order_id;
            setTableActions(null);
            if (id) void openExisting(id);
          }}>Tiếp tục order</Button>
          <Button block danger className="pos-table-actions-cancel" onClick={() => {
            const id = tableActions?.open_order_id;
            setTableActions(null);
            if (id) void getSaleOrder(id).then(confirmCancelOrder).catch((error) =>
              messageApi.error(error instanceof Error ? error.message : "Không tải được Order."));
          }}>Hủy order</Button>
          <Button block type="primary" className="pos-table-actions-payment" onClick={() => {
            const id = tableActions?.open_order_id;
            setTableActions(null);
            if (id) void startCheckout(id);
          }}>Thanh toán</Button>
        </div>
      </Modal>

      {view === "CHECKOUT" && checkoutOrder && (
        <main className="pos-checkout-view">
          <div className="pos-checkout-card">
            <header>
              <div>
                <h2>Thanh toán · {checkoutOrder.area_name} / {checkoutOrder.table_name}</h2>
                <span>{checkoutOrder.order_code}</span>
              </div>
              <Button onClick={() => { setView("MAP"); setCheckoutOrder(null); }}>← Sơ đồ bàn</Button>
            </header>
            <div className="pos-checkout-items">
              <div className="pos-checkout-heading"><b>Món</b><b>SL</b><b>Thành tiền</b></div>
              {checkoutOrder.items.map((line) => (
                <div className="pos-checkout-item" key={line.id}>
                  <div>
                    <strong>{line.item_name_snapshot}</strong>
                    {line.option_name_snapshot && <small>{line.option_name_snapshot}</small>}
                    {line.note && <small>{line.note}</small>}
                    {line.surcharges.map((extra) =>
                      <small key={extra.id}>+ {extra.name}: {money(extra.amount)} đ</small>)}
                  </div>
                  <b>{line.quantity}</b>
                  <strong>{money(line.total_with_surcharges)} đ</strong>
                </div>
              ))}
              {checkoutOrder.surcharges.map((extra) => (
                <div className="pos-checkout-item" key={`extra-${extra.id}`}>
                  <div>Phụ thu · {extra.name}</div><b>1</b>
                  <strong>{money(extra.amount)} đ</strong>
                </div>
              ))}
            </div>
            <div className="pos-checkout-bottom">
              <div className="pos-checkout-total"><b>Tổng tiền</b>
                <strong>{money(checkoutOrder.total_amount)} đ</strong></div>
              <div className="pos-checkout-actions">
                <Button danger disabled={busy}
                  onClick={() => confirmCancelOrder(checkoutOrder)}>Hủy order</Button>
                <Button disabled={busy} loading={busy} onClick={() => void printEstimate()}>
                  In tạm tính
                </Button>
                <Button type="primary" disabled={busy} onClick={openPayment}>Thanh toán</Button>
              </div>
            </div>
          </div>
        </main>
      )}

      <Modal
        open={paymentOpen}
        title={`Thanh toán · ${checkoutOrder?.order_code ?? ""}`}
        width={590}
        onCancel={() => { if (!busy) setPaymentOpen(false); }}
        footer={[
          <Button key="back" disabled={busy} onClick={() => {
            if (paymentStep === "CHOICE") setPaymentOpen(false);
            else if (requestInvoice && paymentStep === "CONFIRM") setPaymentStep("METHOD");
            else if (paymentStep === "METHOD") setPaymentStep("CUSTOMER");
            else setPaymentStep("CHOICE");
          }}>{paymentStep === "CHOICE" ? "Đóng" : "Quay lại"}</Button>,
          paymentStep === "CONFIRM" &&
            <Button key="confirm" type="primary" loading={busy}
              onClick={() => void confirmPayment()}>Xác nhận {paymentMethod === "DEBT" ? "ghi nợ" : "thanh toán"}</Button>,
          paymentStep === "CUSTOMER" && customerId && !customerCreating &&
            <Button key="next" type="primary" onClick={() => {
              if (requestInvoice) setPaymentStep("METHOD");
              else setPaymentStep("CONFIRM");
            }}>Tiếp tục</Button>
        ]}
        destroyOnClose
      >
        <div className="pos-checkout-payment">
          <div className="pos-checkout-total"><b>Tổng tiền</b>
            <strong>{money(checkoutOrder?.total_amount ?? 0)} đ</strong></div>
          {paymentStep === "CHOICE" && (
            <div className="pos-payment-method-grid">
              <button type="button" onClick={() => choosePayment("CASH")}>💵<b>Tiền mặt</b></button>
              <button type="button" onClick={() => choosePayment("BANK")}>🏦<b>Chuyển khoản</b></button>
              <button type="button" onClick={() => choosePayment("DEBT")}>📝<b>Ghi nợ</b></button>
              <button type="button" onClick={() => {
                setRequestInvoice(true);
                setPaymentStep("CUSTOMER");
              }}>🧾<b>HĐĐT</b></button>
            </div>
          )}
          {paymentStep === "CUSTOMER" && (
            <div className="pos-customer-form">
              <strong>{requestInvoice ? "Thông tin xuất HĐĐT" : "Khách hàng ghi nợ"}</strong>
              <Select<number>
                showSearch allowClear placeholder="Tìm tên, số điện thoại hoặc MST"
                optionFilterProp="label"
                value={customerId}
                onChange={(value) => setCustomerId(value)}
                onSearch={(value) => void loadCustomers(value)}
                options={customers.map((customer) => ({
                  value: customer.id,
                  label: `${customer.name} · ${customer.phone || customer.tax_code || customer.customer_code}`
                }))}
              />
              <Button onClick={() => setCustomerCreating((open) => !open)}>
                {customerCreating ? "Đóng form" : "+ Thêm khách hàng"}
              </Button>
              {customerCreating && (
                <div className="pos-customer-fields">
                  <Select value={customerDraft.customer_type}
                    onChange={(value: PosCustomerInput["customer_type"]) =>
                      setCustomerDraft((prev) => ({ ...prev, customer_type: value }))}
                    options={[{ value: "PERSON", label: "Cá nhân" },
                      { value: "ORGANIZATION", label: "Doanh nghiệp" }]} />
                  {([
                    ["name", "Tên khách hàng / công ty"],
                    ["phone", "Số điện thoại"],
                    ["tax_code", "Mã số thuế"],
                    ["address", "Địa chỉ"],
                    ["email", "Email"],
                    ["contact_name", "Người liên hệ"]
                  ] as const).map(([field, placeholder]) => (
                    <Input key={field} placeholder={placeholder}
                      value={customerDraft[field] ?? ""}
                      onChange={(event) => setCustomerDraft((prev) =>
                        ({ ...prev, [field]: event.target.value }))} />
                  ))}
                  <Button type="primary" loading={busy} onClick={() => void saveCustomer()}>
                    Lưu khách hàng
                  </Button>
                </div>
              )}
            </div>
          )}
          {paymentStep === "METHOD" && (
            <div className="pos-payment-method-grid">
              <button onClick={() => choosePayment("CASH", true)}>💵<b>Tiền mặt</b></button>
              <button onClick={() => choosePayment("BANK", true)}>🏦<b>Chuyển khoản</b></button>
              <button onClick={() => choosePayment("DEBT", true)}>📝<b>Ghi nợ</b></button>
            </div>
          )}
          {paymentStep === "CONFIRM" && (
            <div className="pos-payment-fields">
              <strong>{paymentMethod === "CASH" ? "Tiền mặt" :
                paymentMethod === "BANK" ? "Chuyển khoản" : "Ghi nợ"}</strong>
              {(requestInvoice || paymentMethod === "DEBT") && <div>
                Khách: {customers.find((customer) => customer.id === customerId)?.name
                  ?? checkoutOrder?.customer_name ?? "Chưa chọn"}
              </div>}
              {requestInvoice && <div className="pos-invoice-draft-notice">
                Yêu cầu HĐĐT sẽ được lưu chờ phát hành thủ công qua MISA meInvoice.
              </div>}
              {paymentMethod !== "DEBT" && (
                <>
                  <label>Quỹ / tài khoản nhận tiền</label>
                  <Select value={paymentFundAccountId}
                    onChange={setPaymentFundAccountId}
                    options={accounts.filter((account) => account.is_active &&
                      account.type === paymentAccountType).map((account) =>
                      ({ value: account.id, label: account.name }))} />
                  <label>Tiền thực thu (đ)</label>
                  <InputNumber<number> min={0} precision={0} value={paymentAmount}
                    onChange={(value) => setPaymentAmount(Number(value ?? 0))} />
                  <small>Chênh lệch: {money(paymentAmount - (checkoutOrder?.total_amount ?? 0))} đ</small>
                </>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
