import type {
  BackupStatus,
  ItemGroup,
  ItemGroupInput
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
