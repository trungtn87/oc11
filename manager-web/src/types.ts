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
  is_stock_tracked: boolean;
  conversions: ItemUnitConversion[];
};

export type InventoryItemInput = {
  name: string;
  item_group_id: number;
  default_unit_id: number;
  smallest_unit_id: number;
  note: string | null;
  is_active: boolean;
  is_stock_tracked?: boolean;
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
  is_default: boolean;
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
  source_type: string | null;
  source_id: string | null;
  source_reference_code: string | null;
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


export type ItemPurchaseDefault = {
  item_id: number;
  default_unit_id: number;
  last_purchase_time: string | null;
  last_purchase_receipt_code: string | null;
  last_purchase_unit_id: number | null;
  last_purchase_unit_price: number | null;
  unit_prices: Array<{
    unit_id: number;
    unit_name: string;
    suggested_unit_price: number;
  }>;
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
  actual_paid_amount: number | null;
  payment_status: PurchasePaymentStatus;
  payment_reference_code: string | null;
  payment_fund_account_id: number | null;
  payment_account_type: FundAccountType | null;
  shipping_payment_reference_code: string | null;
  shipping_payment_fund_account_id: number | null;
  shipping_payment_account_type: FundAccountType | null;
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
  client_sync_id?: string | null;
  supplier_id: number;
  receipt_time: string;
  description?: string | null;
  shipping_fee: number;
  actual_paid_amount?: number | null;
  payment_status: PurchasePaymentStatus;
  payment?: {
    account_type: FundAccountType;
    fund_account_id: number;
  } | null;
  shipping_payment?: {
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


export type InventoryMovementKind =
  | "PURCHASE"
  | "SALE"
  | "ADJUSTMENT"
  | "OTHER";

export type InventoryStock = {
  item_id: number;
  item_name: string;
  item_group_id: number;
  item_group_name: string;
  smallest_unit_id: number;
  smallest_unit_name: string;
  default_unit_name: string;
  default_unit_conversion_factor: number;
  stock_quantity: number;
  stock_revision: number;
  is_active: boolean;
  is_stock_tracked: boolean;
  last_purchase_time: string | null;
  last_purchase_receipt_code: string | null;
  last_purchase_unit_id: number | null;
  last_purchase_unit_name: string | null;
  last_purchase_unit_price: number | null;
  last_purchase_conversion_factor: number | null;
  last_purchase_price_per_smallest_unit: number | null;
  last_reconciled_at: string | null;
  last_reconciled_quantity: number | null;
};

export type StocktakeLineInput = {
  item_id: number;
  expected_quantity: number;
  expected_revision: number;
  actual_quantity: number;
};

export type StocktakeBatchInput = {
  client_sync_id: string;
  reason?: string;
  note?: string;
  items: StocktakeLineInput[];
};

export type StocktakeBatchOutput = {
  id: number;
  adjustment_code: string;
  adjustment_time: string;
  client_sync_id: string;
  already_synced: boolean;
  items: Array<{
    item_id: number;
    item_name: string;
    smallest_unit_name: string;
    system_quantity: number;
    actual_quantity: number;
    quantity_delta: number;
  }>;
};

export type InventoryMovement = {
  id: number;
  movement_time: string;
  source_type: string;
  movement_kind: InventoryMovementKind;
  movement_label: string;
  source_id: string | null;
  source_line_id: string | null;
  reference_code: string | null;
  quantity_delta: number;
  running_quantity: number;
  note: string | null;
};

export type InventoryHistorySummary = {
  opening_quantity: number;
  purchase_delta: number;
  sales_delta: number;
  adjustment_delta: number;
  other_delta: number;
  closing_quantity: number;
};

export type InventoryItemHistory = {
  item_id: number;
  item_name: string;
  item_group_name: string;
  smallest_unit_id: number;
  smallest_unit_name: string;
  from_time: string;
  to_time: string;
  movement_filter: "ALL" | InventoryMovementKind;
  summary: InventoryHistorySummary;
  items: InventoryMovement[];
};

export type StockAdjustmentInput = {
  item_id: number;
  actual_quantity: number;
  adjustment_time?: string | null;
  reason?: string | null;
  note?: string | null;
};

export type StockAdjustment = {
  id: number;
  adjustment_code: string;
  adjustment_time: string;
  item_id: number;
  item_name: string;
  smallest_unit_name: string;
  system_quantity: number;
  actual_quantity: number;
  quantity_delta: number;
  reason: string | null;
  note: string | null;
  created_at: string;
};


export type RecipeIngredientInput = {
  item_id: number;
  unit_id: number;
  quantity: number;
};

export type CostRecipeInput = {
  output_quantity: number;
  output_unit_id: number;
  waste_percent: number;
  alert_threshold_percent: number;
  is_active: boolean;
  items: RecipeIngredientInput[];
};

export type ServiceOptionCostInput = {
  name: string;
  note: string | null;
  display_order: number;
  is_active: boolean;
  recipe: CostRecipeInput | null;
};

export type CostRecipeItem = {
  id: number;
  item_id: number;
  item_name: string;
  unit_id: number;
  unit_name: string;
  quantity: number;
  conversion_factor: number;
  quantity_in_smallest_unit: number;
  smallest_unit_id: number;
  smallest_unit_name: string;
  current_price_per_smallest_unit: number | null;
  line_cost: number | null;
  price_source_receipt_code: string | null;
  price_source_receipt_time: string | null;
};

export type CostRecipe = {
  id: number;
  service_option_id: number;
  output_quantity: number;
  output_unit_id: number;
  output_unit_name: string;
  waste_percent: number;
  alert_threshold_percent: number;
  is_active: boolean;
  reference_unit_cost: number | null;
  base_cost: number | null;
  total_cost: number | null;
  current_unit_cost: number | null;
  change_percent: number | null;
  cost_complete: boolean;
  has_open_alert: boolean;
  items: CostRecipeItem[];
};

export type ServiceOptionCost = {
  id: number;
  name: string;
  note: string | null;
  display_order: number;
  is_active: boolean;
  recipe: CostRecipe | null;
};

export type CostAlert = {
  id: number;
  recipe_id: number;
  service_option_id: number;
  service_option_name: string;
  reference_unit_cost: number;
  current_unit_cost: number;
  change_percent: number;
  alert_threshold_percent: number;
  status: "OPEN" | "RESOLVED";
  detected_at: string;
  resolved_at: string | null;
};

export type CostIngredientPrice = {
  item_id: number;
  item_name: string;
  smallest_unit_id: number;
  smallest_unit_name: string;
  current_price_per_smallest_unit: number | null;
  price_source_receipt_code: string | null;
  price_source_receipt_time: string | null;
};


export type MenuGroup = {
  id: number;
  name: string;
  display_order: number;
  is_active: boolean;
  note: string | null;
};

export type MenuGroupInput = Omit<MenuGroup, "id">;

export type MenuComponentInput = {
  component_type: "ITEM" | "RECIPE";
  item_id: number | null;
  unit_id: number | null;
  recipe_id: number | null;
  quantity: number;
};

export type MenuIngredientInput = {
  item_id: number;
  unit_id: number;
  quantity: number;
};

export type MenuItemOptionInput = {
  service_option_id: number;
  extra_price: number;
  display_order: number;
  is_active: boolean;
  components: MenuComponentInput[];
};

export type KitchenPrintMenuItem = {
  id: number;
  name: string;
  print_to_kitchen: boolean;
};

export type MenuItemInput = {
  name: string;
  menu_group_id: number;
  sale_unit_id: number;
  base_price: number;
  display_order: number;
  is_active: boolean;
  note: string | null;
  ingredients: MenuIngredientInput[];
  options: MenuItemOptionInput[];
};

export type MenuIngredient = {
  id: number;
  item_id: number;
  item_name: string;
  unit_id: number;
  unit_name: string;
  quantity: number;
  unit_cost: number | null;
  line_cost: number | null;
  cost_complete: boolean;
};

export type MenuComponent = {
  id: number;
  component_type: "ITEM" | "RECIPE";
  item_id: number | null;
  item_name: string | null;
  unit_id: number | null;
  unit_name: string | null;
  recipe_id: number | null;
  recipe_name: string | null;
  recipe_output_unit_name: string | null;
  quantity: number;
  unit_cost: number | null;
  line_cost: number | null;
  cost_complete: boolean;
};

export type MenuItemOption = {
  id: number;
  service_option_id: number;
  service_option_name: string;
  extra_price: number;
  sale_price: number;
  alert_threshold_percent: number;
  display_order: number;
  is_active: boolean;
  reference_cost: number | null;
  current_cost: number | null;
  change_percent: number | null;
  cost_percent: number | null;
  cost_complete: boolean;
  has_open_alert: boolean;
  components: MenuComponent[];
};

export type MenuItem = {
  id: number;
  name: string;
  menu_group_id: number;
  menu_group_name: string;
  sale_unit_id: number;
  sale_unit_name: string;
  base_price: number;
  alert_threshold_percent: number;
  reference_cost: number | null;
  has_open_alert: boolean;
  display_order: number;
  is_active: boolean;
  note: string | null;
  ingredients: MenuIngredient[];
  options: MenuItemOption[];
};

export type MenuCostAlert = {
  id: number;
  menu_item_id: number;
  menu_item_name: string;
  reference_cost: number;
  current_cost: number;
  change_percent: number;
  alert_threshold_percent: number;
  status: "OPEN" | "RESOLVED";
  detected_at: string;
  resolved_at: string | null;
};


export type ConsumptionBreakdownItem = {
  item_id: number;
  item_name: string;
  item_group_name: string;
  smallest_unit_id: number;
  smallest_unit_name: string;
  quantity: number;
};

export type ConsumptionPreview = {
  menu_item_id: number;
  menu_item_name: string;
  menu_item_option_id: number | null;
  service_option_id: number | null;
  service_option_name: string | null;
  sale_unit_name: string;
  sold_quantity: number;
  items: ConsumptionBreakdownItem[];
};

export type ConsumptionSummaryItem = {
  item_id: number;
  item_name: string;
  item_group_id: number;
  item_group_name: string;
  smallest_unit_id: number;
  smallest_unit_name: string;
  consumed_quantity: number;
  sale_line_count: number;
  last_sale_time: string | null;
  stock_quantity: number;
  last_reconciled_at: string | null;
  last_reconciled_quantity: number | null;
};

export type ConsumptionSummary = {
  from_time: string;
  to_time: string;
  items: ConsumptionSummaryItem[];
};


export type RestaurantArea = {
  id: number;
  name: string;
  display_order: number;
  is_active: boolean;
};

export type RestaurantAreaInput = Omit<RestaurantArea, "id">;

export type RestaurantTable = {
  id: number;
  area_id: number;
  area_name: string;
  name: string;
  seats: number;
  display_order: number;
  pos_x: number;
  pos_y: number;
  is_active: boolean;
  open_order_id: number | null;
  open_order_code: string | null;
  open_order_total: number | null;
  open_order_time: string | null;
  guest_count: number;
};

export type RestaurantTableInput = {
  area_id: number;
  name: string;
  seats: number;
  display_order: number;
  pos_x: number;
  pos_y: number;
  is_active: boolean;
};

export type PrinterRole = "KITCHEN" | "CASHIER";
export type PrinterTarget = PrinterRole | "BOTH";

export type PosPrintTemplateKind = "KITCHEN" | "CHECK" | "ESTIMATE" | "RECEIPT";

export type PosPrintTemplate = {
  printer_name: string;
  title_font_pt: number;
  body_font_pt: number;
  total_font_pt: number;
  line_spacing: number;
  left_margin_mm: number;
  title_text: string;
  shop_name: string;
  shop_phone: string;
  shop_address: string;
  footer_text: string;
  show_shop_name: boolean;
  show_phone: boolean;
  show_address: boolean;
  show_table: boolean;
  show_time: boolean;
  show_options: boolean;
  show_notes: boolean;
  show_surcharges: boolean;
  show_prices: boolean;
  show_payment: boolean;
  show_footer: boolean;
};

export type PosSettings = {
  kitchen_printer_name: string;
  cashier_printer_name: string;
  send_kitchen_targets: PrinterTarget;
  print_receipt_targets: PrinterTarget;
};

export type PrintDestinationResult = {
  role: PrinterRole;
  printer_name: string | null;
  ok: boolean;
  error: string | null;
};

export type PosPrintResult = {
  order_id: number;
  order_code: string;
  print_status: "PRINTED" | "FAILED";
  error_message: string | null;
  printer_results: PrintDestinationResult[];
};

export type KitchenSendResult = Omit<PosPrintResult, "print_status"> & {
  print_status: "PRINTED" | "FAILED" | "NO_NEW_ITEMS";
  ticket_id: number | null;
  sent_at: string | null;
  printer_name: string | null;
};

export type PosCustomer = {
  id: number;
  customer_code: string;
  customer_type: "PERSON" | "ORGANIZATION";
  name: string;
  phone: string | null;
  tax_code: string | null;
  address: string | null;
  email: string | null;
  contact_name: string | null;
};

export type PosCustomerInput = Omit<PosCustomer, "id" | "customer_code">;

export type SaleOrderStatus = "OPEN" | "PAID" | "VOID";
export type SaleOrderType = "DINE_IN" | "TAKEAWAY";

export type SaleSurcharge = {
  id: number;
  name: string;
  amount: number;
};

export type SaleSurchargeInput = {
  name: string;
  amount: number;
};

export type SurchargePreset = {
  id: number;
  name: string;
  amount: number;
};

export type SurchargePresetInput = {
  name: string;
  amount: number;
};

export type SaleOrderItem = {
  id: number;
  menu_item_id: number | null;
  menu_item_option_id: number | null;
  item_name_snapshot: string;
  option_name_snapshot: string | null;
  unit_name_snapshot: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  surcharge_total: number;
  total_with_surcharges: number;
  unit_cost_snapshot: number | null;
  cost_total_snapshot: number | null;
  note: string | null;
  surcharges: SaleSurcharge[];
};

export type SaleOrder = {
  id: number;
  order_code: string;
  order_time: string;
  status: SaleOrderStatus;
  order_type: SaleOrderType;
  table_id: number | null;
  table_name: string | null;
  area_id: number | null;
  area_name: string | null;
  guest_count: number;
  kitchen_sent_at: string | null;
  customer_id: number | null;
  customer_name: string | null;
  fund_account_id: number | null;
  fund_account_name: string | null;
  fund_account_type: FundAccountType | null;
  settlement_status: "PAID" | "DEBT";
  einvoice_requested: boolean;
  total_amount: number;
  surcharge_total: number;
  actual_received_amount: number | null;
  payment_reference_code: string | null;
  paid_at: string | null;
  note: string | null;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string | null;
  stock_deducted: boolean;
  has_einvoice: boolean;
  einvoice_issued_at: string | null;
  can_edit: boolean;
  can_delete: boolean;
  items: SaleOrderItem[];
  surcharges: SaleSurcharge[];
};

export type SaleOrderInput = {
  order_time?: string | null;
  order_type?: SaleOrderType | null;
  table_id?: number | null;
  guest_count?: number | null;
  customer_id?: number | null;
  note?: string | null;
  payment_status?: "PAID" | "DEBT" | null; // legacy callers
  settlement_target?: "OPEN" | "DEBT" | "PAID" | null;
  items: Array<{
    menu_item_id: number;
    menu_item_option_id?: number | null;
    quantity: number;
    note?: string | null;
    surcharges?: SaleSurchargeInput[];
  }>;
  surcharges?: SaleSurchargeInput[];
  fund_account_id?: number | null;
  actual_received_amount?: number | null;
};

export type SalePaymentInput = {
  fund_account_id?: number | null;
  actual_received_amount?: number | null;
  payment_method?: "CASH" | "BANK" | "DEBT";
  expected_total_amount?: number;
  customer_id?: number | null;
  request_einvoice?: boolean;
};
