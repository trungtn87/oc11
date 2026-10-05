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
  InventoryItemHistory,
  InventoryStock,
  StockAdjustment,
  StockAdjustmentInput,
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
  MenuItemInput,
  CostAlert,
  CostIngredientPrice,
  CostRecipe,
  ServiceOptionCost,
  ServiceOptionCostInput,
  Supplier,
  SupplierInput,
  Unit,
  UnitInput
} from "./types";

type ApiErrorPayload = {
  detail?: string;
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
      if (payload.detail) {
        detail = payload.detail;
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
