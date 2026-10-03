export type ItemGroup = {
  id: number;
  name: string;
  note: string | null;
  is_active: boolean;
};

export type ItemGroupInput = Omit<ItemGroup, "id">;

export type BackupStatus = {
  enabled: boolean;
  folder: string;
  google_drive_configured: boolean;
  latest_backup: string | null;
  latest_file_exists: boolean;
  daily_backup_count: number;
  last_error: string | null;
  reason: string | null;
};


export type Supplier = {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  note: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  payment_qr_image: string | null;
  can_delete: boolean;
};

export type SupplierInput = Omit<Supplier, "id" | "can_delete">;
