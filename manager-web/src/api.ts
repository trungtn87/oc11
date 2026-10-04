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
  ItemGroup,
  ItemGroupInput,
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
