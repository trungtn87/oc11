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

export type Unit = {
  id: number;
  name: string;
  is_active: boolean;
};

export type UnitInput = Omit<Unit, "id">;

export type ItemUnitConversion = {
  id: number;
  unit_id: number;
  unit_name: string;
  quantity_in_smallest_unit: number;
  is_active: boolean;
};

export type ItemUnitConversionInput = {
  unit_id: number;
  quantity_in_smallest_unit: number;
  is_active: boolean;
};

export type InventoryItem = {
  id: number;
  name: string;
  item_group_id: number;
  item_group_name: string;
  default_unit_id: number;
  default_unit_name: string;
  smallest_unit_id: number;
  smallest_unit_name: string;
  note: string | null;
  is_active: boolean;
  conversions: ItemUnitConversion[];
};

export type InventoryItemInput = {
  name: string;
  item_group_id: number;
  default_unit_id: number;
  smallest_unit_id: number;
  note: string | null;
  is_active: boolean;
  conversions: ItemUnitConversionInput[];
};


export type FundAccountType = "CASH" | "BANK";

export type FundAccount = {
  id: number;
  name: string;
  type: FundAccountType;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  current_balance: number;
  is_active: boolean;
  note: string | null;
  can_delete: boolean;
};

export type FundAccountInput = Omit<
  FundAccount,
  "id" | "current_balance" | "can_delete"
>;


export type FundTransaction = {
  id: number;
  fund_account_id: number;
  fund_account_name: string;
  account_type: FundAccountType;
  transaction_time: string;
  transaction_type: string;
  direction: "IN" | "OUT";
  amount: number;
  reference_code: string | null;
  description: string | null;
  note: string | null;
  running_balance: number;
};

export type FundTransactionList = {
  opening_balance: number;
  total_in: number;
  total_out: number;
  closing_balance: number;
  items: FundTransaction[];
};


export type FundTransactionType =
  | "NORMAL"
  | "TRANSFER"
  | "BALANCE_ADJUSTMENT"
  | "OPENING_BALANCE";

export type FundTransactionCreateInput = {
  account_type: FundAccountType;
  fund_account_id: number;
  direction: "IN" | "OUT";
  transaction_type: FundTransactionType;
  transaction_time: string;
  amount?: number;
  actual_balance?: number;
  related_fund_account_id?: number;
  description?: string | null;
  note?: string | null;
};

export type FundTransactionCreateOutput = {
  created_ids: number[];
  reference_codes: string[];
};
