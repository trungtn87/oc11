import type {
  BackupStatus,
  FundAccount,
  FundAccountInput,
  FundAccountType,
  FundTransactionCreateInput,
  FundTransactionCreateOutput,
  FundTransactionList,
  FundTransactionCategory,
  FundTransactionCategoryInput,
  InventoryItem,
  InventoryItemInput,
  ItemPurchaseDefault,
  InventoryItemHistory,
  InventoryStock,
  StockAdjustment,
  StockAdjustmentInput,
  StocktakeBatchInput,
  StocktakeBatchOutput,
  ItemGroup,
  ItemGroupInput,
  PurchaseReceipt,
  PurchaseReceiptInput,
  ConsumptionPreview,
  ConsumptionSummary,
  MenuCostAlert,
  MenuGroup,
  MenuGroupInput,
  MenuItem,
  KitchenPrintMenuItem,
  MenuItemInput,
  CostAlert,
  CostIngredientPrice,
  CostRecipe,
  ServiceOptionCost,
  ServiceOptionCostInput,
  Supplier,
  SupplierInput,
  Unit,
  UnitInput,
  SaleOrder,
  SaleOrderInput,
  SalePaymentInput,
  SurchargePreset,
  SurchargePresetInput,
  RestaurantArea,
  RestaurantAreaInput,
  RestaurantTable,
  RestaurantTableInput,
  PosSettings,
  KitchenSendResult,
  PosPrintResult,
  PosCustomer,
  PosCustomerInput,
  PrinterRole
} from "./types";

type ApiErrorPayload = {
  detail?: string | {
    code?: string;
    message?: string;
    items?: Array<{ item_name?: string }>;
  };
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    let detail = "Có lỗi xảy ra.";

    try {
      const payload = (await response.json()) as ApiErrorPayload;
      if (typeof payload.detail === "string") {
        detail = payload.detail;
      } else if (payload.detail) {
        const names = payload.detail.items?.map((item) => item.item_name).filter(Boolean);
        detail = payload.detail.message ?? "Dữ liệu kho đã thay đổi.";
        if (names?.length) detail += ` Mặt hàng: ${names.join(", ")}.`;
      }
    } catch {
      // Keep the generic message when the response has no JSON body.
    }

    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export function getItemGroups(): Promise<ItemGroup[]> {
  return request<ItemGroup[]>("/api/item-groups");
}

export function createItemGroup(payload: ItemGroupInput): Promise<ItemGroup> {
  return request<ItemGroup>("/api/item-groups", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateItemGroup(
  id: number,
  payload: ItemGroupInput
): Promise<ItemGroup> {
  return request<ItemGroup>(`/api/item-groups/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getBackupStatus(): Promise<BackupStatus> {
  return request<BackupStatus>("/api/backup/status");
}

export function runBackup(): Promise<BackupStatus> {
  return request<BackupStatus>("/api/backup/run", {
    method: "POST"
  });
}

export function selectBackupFolder(): Promise<BackupStatus> {
  return request<BackupStatus>("/api/backup/select-folder", {
    method: "POST"
  });
}

export function useLocalBackupFolder(): Promise<BackupStatus> {
  return request<BackupStatus>("/api/backup/use-local-folder", {
    method: "POST"
  });
}


export function getSuppliers(): Promise<Supplier[]> {
  return request<Supplier[]>("/api/suppliers");
}

export function createSupplier(payload: SupplierInput): Promise<Supplier> {
  return request<Supplier>("/api/suppliers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateSupplier(
  id: number,
  payload: SupplierInput
): Promise<Supplier> {
  return request<Supplier>(`/api/suppliers/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteSupplier(id: number): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/suppliers/${id}`, {
    method: "DELETE"
  });
}


export function getUnits(): Promise<Unit[]> {
  return request<Unit[]>("/api/units");
}

export function createUnit(payload: UnitInput): Promise<Unit> {
  return request<Unit>("/api/units", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateUnit(
  id: number,
  payload: UnitInput
): Promise<Unit> {
  return request<Unit>(`/api/units/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}


export function getInventoryItems(): Promise<InventoryItem[]> {
  return request<InventoryItem[]>("/api/items");
}

export function getItemPurchaseDefaults(): Promise<ItemPurchaseDefault[]> {
  return request<ItemPurchaseDefault[]>("/api/items/purchase-defaults");
}

export function createInventoryItem(
  payload: InventoryItemInput
): Promise<InventoryItem> {
  return request<InventoryItem>("/api/items", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateInventoryItem(
  id: number,
  payload: InventoryItemInput
): Promise<InventoryItem> {
  return request<InventoryItem>(`/api/items/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}


export function setItemStockTracking(
  id: number,
  isStockTracked: boolean
): Promise<InventoryItem> {
  return request<InventoryItem>(`/api/items/${id}/stock-tracking`, {
    method: "PATCH",
    body: JSON.stringify({ is_stock_tracked: isStockTracked })
  });
}

export function getFundAccounts(type?: FundAccountType): Promise<FundAccount[]> {
  const query = type ? `?type=${type}` : "";
  return request<FundAccount[]>(`/api/fund-accounts${query}`);
}

export function createFundAccount(
  payload: FundAccountInput
): Promise<FundAccount> {
  return request<FundAccount>("/api/fund-accounts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateFundAccount(
  id: number,
  payload: FundAccountInput
): Promise<FundAccount> {
  return request<FundAccount>(`/api/fund-accounts/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteFundAccount(
  id: number
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/fund-accounts/${id}`, {
    method: "DELETE"
  });
}


export function getFundTransactions(params: {
  account_type: FundAccountType;
  fund_account_id?: number;
  from_date?: string;
  to_date?: string;
}): Promise<FundTransactionList> {
  const search = new URLSearchParams();
  search.set("account_type", params.account_type);

  if (params.fund_account_id !== undefined) {
    search.set("fund_account_id", String(params.fund_account_id));
  }
  if (params.from_date) {
    search.set("from_date", params.from_date);
  }
  if (params.to_date) {
    search.set("to_date", params.to_date);
  }

  return request<FundTransactionList>(
    `/api/fund-transactions?${search.toString()}`
  );
}


export function createFundTransaction(
  payload: FundTransactionCreateInput
): Promise<FundTransactionCreateOutput> {
  return request<FundTransactionCreateOutput>("/api/fund-transactions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}


export function getFundTransactionCategories(
  direction?: "IN" | "OUT"
): Promise<FundTransactionCategory[]> {
  const query = direction ? `?direction=${direction}` : "";
  return request<FundTransactionCategory[]>(
    `/api/fund-transaction-categories${query}`
  );
}

export function createFundTransactionCategory(
  payload: FundTransactionCategoryInput
): Promise<FundTransactionCategory> {
  return request<FundTransactionCategory>("/api/fund-transaction-categories", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateFundTransactionCategory(
  id: number,
  payload: FundTransactionCategoryInput
): Promise<FundTransactionCategory> {
  return request<FundTransactionCategory>(
    `/api/fund-transaction-categories/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}


export function getPurchaseReceipts(params?: {
  supplier_id?: number;
  payment_status?: "PAID" | "DEBT";
  search?: string;
}): Promise<PurchaseReceipt[]> {
  const query = new URLSearchParams();
  if (params?.supplier_id !== undefined) {
    query.set("supplier_id", String(params.supplier_id));
  }
  if (params?.payment_status) {
    query.set("payment_status", params.payment_status);
  }
  if (params?.search?.trim()) {
    query.set("search", params.search.trim());
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<PurchaseReceipt[]>(`/api/purchase-receipts${suffix}`);
}

export function getPurchaseReceipt(id: number): Promise<PurchaseReceipt> {
  return request<PurchaseReceipt>(`/api/purchase-receipts/${id}`);
}

export function createPurchaseReceipt(
  payload: PurchaseReceiptInput
): Promise<PurchaseReceipt> {
  return request<PurchaseReceipt>("/api/purchase-receipts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}


export function updatePurchaseReceipt(
  id: number,
  payload: PurchaseReceiptInput
): Promise<PurchaseReceipt> {
  return request<PurchaseReceipt>(`/api/purchase-receipts/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function voidPurchaseReceiptForReentry(
  id: number
): Promise<PurchaseReceipt> {
  return request<PurchaseReceipt>(
    `/api/purchase-receipts/${id}/void-for-reentry`,
    { method: "POST" }
  );
}


export function getInventoryStock(params?: {
  search?: string;
  group_id?: number;
  as_of?: string;
  tracking?: "ALL" | "TRACKED" | "UNTRACKED";
}): Promise<InventoryStock[]> {
  const query = new URLSearchParams();

  if (params?.search?.trim()) {
    query.set("search", params.search.trim());
  }
  if (params?.group_id !== undefined) {
    query.set("group_id", String(params.group_id));
  }
  if (params?.as_of) {
    query.set("as_of", params.as_of);
  }
  if (params?.tracking) {
    query.set("tracking", params.tracking);
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<InventoryStock[]>(`/api/inventory/stock${suffix}`);
}

export function getInventoryItemHistory(
  itemId: number,
  params: {
    from: string;
    to: string;
    type?: "ALL" | "PURCHASE" | "SALE" | "ADJUSTMENT" | "OTHER";
  }
): Promise<InventoryItemHistory> {
  const query = new URLSearchParams();
  query.set("from", params.from);
  query.set("to", params.to);
  query.set("type", params.type ?? "ALL");

  return request<InventoryItemHistory>(
    `/api/inventory/items/${itemId}/history?${query.toString()}`
  );
}

export function createStockAdjustment(
  payload: StockAdjustmentInput
): Promise<StockAdjustment> {
  return request<StockAdjustment>("/api/inventory/adjustments", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}


export function createStocktakeBatch(
  payload: StocktakeBatchInput
): Promise<StocktakeBatchOutput> {
  return request<StocktakeBatchOutput>("/api/inventory/adjustments/batch", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getServiceOptionCosts(): Promise<ServiceOptionCost[]> {
  return request<ServiceOptionCost[]>("/api/cost/service-options");
}

export function createServiceOptionCost(
  payload: ServiceOptionCostInput
): Promise<ServiceOptionCost> {
  return request<ServiceOptionCost>("/api/cost/service-options", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateServiceOptionCost(
  id: number,
  payload: ServiceOptionCostInput
): Promise<ServiceOptionCost> {
  return request<ServiceOptionCost>(`/api/cost/service-options/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getCostIngredientPrices(): Promise<CostIngredientPrice[]> {
  return request<CostIngredientPrice[]>("/api/cost/ingredient-prices");
}

export function getCostAlerts(includeResolved = false): Promise<CostAlert[]> {
  const query = includeResolved ? "?include_resolved=true" : "";
  return request<CostAlert[]>(`/api/cost/alerts${query}`);
}

export function acceptCurrentRecipeCost(recipeId: number): Promise<CostRecipe> {
  return request<CostRecipe>(
    `/api/cost/recipes/${recipeId}/accept-current-cost`,
    { method: "POST" }
  );
}


export function getMenuGroups(): Promise<MenuGroup[]> {
  return request<MenuGroup[]>("/api/menu/groups");
}

export function createMenuGroup(payload: MenuGroupInput): Promise<MenuGroup> {
  return request<MenuGroup>("/api/menu/groups", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateMenuGroup(
  id: number,
  payload: MenuGroupInput
): Promise<MenuGroup> {
  return request<MenuGroup>(`/api/menu/groups/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getKitchenPrintMenuItems(): Promise<KitchenPrintMenuItem[]> {
  return request<KitchenPrintMenuItem[]>("/api/menu/kitchen-print-items");
}

export function saveKitchenPrintMenuItems(
  items: Array<{ menu_item_id: number; print_to_kitchen: boolean }>
): Promise<KitchenPrintMenuItem[]> {
  return request<KitchenPrintMenuItem[]>("/api/menu/kitchen-print-items", {
    method: "PUT",
    body: JSON.stringify({ items })
  });
}

export function getMenuItems(): Promise<MenuItem[]> {
  return request<MenuItem[]>("/api/menu/items");
}

export function getMenuItem(id: number): Promise<MenuItem> {
  return request<MenuItem>(`/api/menu/items/${id}`);
}

export function createMenuItem(payload: MenuItemInput): Promise<MenuItem> {
  return request<MenuItem>("/api/menu/items", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateMenuItem(
  id: number,
  payload: MenuItemInput
): Promise<MenuItem> {
  return request<MenuItem>(`/api/menu/items/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getMenuCostAlerts(
  includeResolved = false
): Promise<MenuCostAlert[]> {
  const query = includeResolved ? "?include_resolved=true" : "";
  return request<MenuCostAlert[]>(`/api/menu/alerts${query}`);
}

export function acceptMenuItemCurrentCost(
  menuItemId: number
): Promise<MenuItem> {
  return request<MenuItem>(
    `/api/menu/items/${menuItemId}/accept-current-cost`,
    { method: "POST" }
  );
}


export function previewConsumption(payload: {
  menu_item_option_id: number;
  quantity: number;
}): Promise<ConsumptionPreview> {
  return request<ConsumptionPreview>("/api/inventory/consumption/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getConsumptionSummary(params: {
  from: string;
  to: string;
  search?: string;
  group_id?: number;
}): Promise<ConsumptionSummary> {
  const query = new URLSearchParams({
    from: params.from,
    to: params.to
  });
  if (params.search?.trim()) {
    query.set("search", params.search.trim());
  }
  if (params.group_id) {
    query.set("group_id", String(params.group_id));
  }
  return request<ConsumptionSummary>(
    `/api/inventory/consumption?${query.toString()}`
  );
}


export function getSaleOrders(params?: {
  status?: "OPEN" | "PAID" | "DEBT" | "VOID";
  search?: string;
  from_date?: string;
  to_date?: string;
  fund_account_id?: number;
}): Promise<SaleOrder[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.search?.trim()) query.set("search", params.search.trim());
  if (params?.from_date) query.set("from_date", params.from_date);
  if (params?.to_date) query.set("to_date", params.to_date);
  if (params?.fund_account_id !== undefined)
    query.set("fund_account_id", String(params.fund_account_id));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<SaleOrder[]>(`/api/sales/orders${suffix}`);
}

export function getSaleOrder(id: number): Promise<SaleOrder> {
  return request<SaleOrder>(`/api/sales/orders/${id}`);
}

export function createSaleOrder(payload: SaleOrderInput): Promise<SaleOrder> {
  return request<SaleOrder>("/api/sales/orders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateSaleOrder(
  id: number,
  payload: SaleOrderInput
): Promise<SaleOrder> {
  return request<SaleOrder>(`/api/sales/orders/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function paySaleOrder(
  id: number,
  payload: SalePaymentInput
): Promise<SaleOrder> {
  return request<SaleOrder>(`/api/sales/orders/${id}/pay`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function voidSaleOrder(
  id: number,
  reason?: string
): Promise<SaleOrder> {
  const query = reason?.trim()
    ? `?reason=${encodeURIComponent(reason.trim())}`
    : "";
  return request<SaleOrder>(`/api/sales/orders/${id}/void${query}`, {
    method: "POST"
  });
}


export function getSurchargePresets(): Promise<SurchargePreset[]> {
  return request<SurchargePreset[]>("/api/sales/surcharges");
}

export function createSurchargePreset(
  payload: SurchargePresetInput
): Promise<SurchargePreset> {
  return request<SurchargePreset>("/api/sales/surcharges", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateSurchargePreset(
  id: number,
  payload: SurchargePresetInput
): Promise<SurchargePreset> {
  return request<SurchargePreset>(`/api/sales/surcharges/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteSurchargePreset(id: number): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/sales/surcharges/${id}`, {
    method: "DELETE"
  });
}


export function getRestaurantAreas(activeOnly = false): Promise<RestaurantArea[]> {
  const suffix = activeOnly ? "?active_only=true" : "";
  return request<RestaurantArea[]>(`/api/pos/areas${suffix}`);
}

export function createRestaurantArea(
  payload: RestaurantAreaInput
): Promise<RestaurantArea> {
  return request<RestaurantArea>("/api/pos/areas", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateRestaurantArea(
  id: number,
  payload: RestaurantAreaInput
): Promise<RestaurantArea> {
  return request<RestaurantArea>(`/api/pos/areas/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getRestaurantTables(params?: {
  area_id?: number;
  active_only?: boolean;
}): Promise<RestaurantTable[]> {
  const query = new URLSearchParams();
  if (params?.area_id !== undefined) query.set("area_id", String(params.area_id));
  if (params?.active_only) query.set("active_only", "true");
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<RestaurantTable[]>(`/api/pos/tables${suffix}`);
}

export function createRestaurantTable(
  payload: RestaurantTableInput
): Promise<RestaurantTable> {
  return request<RestaurantTable>("/api/pos/tables", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createRestaurantTablesBulk(
  areaId: number,
  quantity: number
): Promise<RestaurantTable[]> {
  return request<RestaurantTable[]>("/api/pos/tables/bulk", {
    method: "POST",
    body: JSON.stringify({
      area_id: areaId,
      quantity
    })
  });
}

export function updateRestaurantTable(
  id: number,
  payload: RestaurantTableInput
): Promise<RestaurantTable> {
  return request<RestaurantTable>(`/api/pos/tables/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getPosSettings(): Promise<PosSettings> {
  return request<PosSettings>("/api/pos/settings");
}

export function updatePosSettings(payload: PosSettings): Promise<PosSettings> {
  return request<PosSettings>("/api/pos/settings", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getInstalledPrinters(): Promise<string[]> {
  return request<string[]>("/api/pos/printers");
}

export function testPosPrinter(role: PrinterRole): Promise<{
  ok: boolean;
  printer_name: string | null;
  error: string | null;
}> {
  return request(`/api/pos/printer/test?role=${role}`, { method: "POST" });
}

export function sendSaleOrderToKitchen(
  orderId: number,
  temporaryNote = ""
): Promise<KitchenSendResult> {
  return request<KitchenSendResult>(
    `/api/pos/orders/${orderId}/send-kitchen`,
    { method: "POST", body: JSON.stringify({ temporary_note: temporaryNote }) }
  );
}

export function printSaleOrderReceipt(orderId: number): Promise<PosPrintResult> {
  return request<PosPrintResult>(
    `/api/pos/orders/${orderId}/print-receipt`,
    { method: "POST" }
  );
}

export function getPosCustomers(query = ""): Promise<PosCustomer[]> {
  return request<PosCustomer[]>(
    `/api/pos/customers?q=${encodeURIComponent(query)}`
  );
}

export function createPosCustomer(payload: PosCustomerInput): Promise<PosCustomer> {
  return request<PosCustomer>("/api/pos/customers", {
    method: "POST", body: JSON.stringify(payload)
  });
}

export function printSaleOrderEstimate(orderId: number): Promise<PosPrintResult> {
  return request<PosPrintResult>(`/api/pos/orders/${orderId}/print-estimate`, {
    method: "POST"
  });
}

export function printSaleOrderCancellation(orderId: number): Promise<PosPrintResult> {
  return request<PosPrintResult>(`/api/pos/orders/${orderId}/print-cancel`, {
    method: "POST"
  });
}
