import type {
  BackupStatus,
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
