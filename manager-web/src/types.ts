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
  category_id: number | null;
  category_name: string | null;
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
  category_id?: number;
  amount?: number;
  actual_balance?: number;
  related_fund_account_id?: number;
  description?: string | null;
  note?: string | null;
  source_type?: string | null;
  source_id?: string | null;
};

export type FundTransactionCreateOutput = {
  created_ids: number[];
  reference_codes: string[];
};


export type FundTransactionCategory = {
  id: number;
  name: string;
  direction: "IN" | "OUT";
  is_active: boolean;
  sort_order: number;
  can_change_direction: boolean;
};

export type FundTransactionCategoryInput = {
  name: string;
  direction: "IN" | "OUT";
  is_active: boolean;
  sort_order: number;
};


export type PurchasePaymentStatus = "PAID" | "DEBT";

export type PurchaseReceiptItem = {
  id: number;
  item_id: number;
  item_name: string;
  unit_id: number;
  unit_name: string;
  quantity: number;
  conversion_factor: number;
  quantity_in_smallest_unit: number;
  smallest_unit_name: string;
  unit_price: number;
  line_total: number;
  note: string | null;
};

export type PurchaseReceipt = {
  id: number;
  receipt_code: string;
  supplier_id: number;
  supplier_name: string;
  receipt_time: string;
  description: string | null;
  goods_total: number;
  shipping_fee: number;
  total_amount: number;
  payment_status: PurchasePaymentStatus;
  payment_reference_code: string | null;
  payment_fund_account_id: number | null;
  payment_account_type: FundAccountType | null;
  replaces_receipt_id: number | null;
  replaces_receipt_code: string | null;
  replacement_receipt_id: number | null;
  replacement_receipt_code: string | null;
  is_void: boolean;
  voided_at: string | null;
  created_at: string;
  updated_at: string | null;
  items: PurchaseReceiptItem[];
};

export type PurchaseReceiptInput = {
  supplier_id: number;
  receipt_time: string;
  description?: string | null;
  shipping_fee: number;
  payment_status: PurchasePaymentStatus;
  payment?: {
    account_type: FundAccountType;
    fund_account_id: number;
  } | null;
  replaces_receipt_id?: number | null;
  items: Array<{
    item_id: number;
    unit_id: number;
    quantity: number;
    unit_price: number;
    note?: string | null;
  }>;
};

export type VoucherPrefill = {
  direction: "OUT";
  amount: number;
  description: string;
  note?: string | null;
  category_name?: string;
  source_type?: string;
  source_id?: string;
};
