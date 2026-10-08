import type { InventoryStock } from "./types";

// The ledger and stocktake requests always use the smallest unit.
// Only presentation converts stock to the latest purchased unit.
export function displayStockQuantity(stock: InventoryStock): number {
  const factor = stock.last_purchase_conversion_factor;
  return stock.stock_quantity / (factor !== null && factor > 0 ? factor : 1);
}

export function displayStockUnit(stock: InventoryStock): string {
  return stock.last_purchase_unit_name || stock.smallest_unit_name;
}

// Negative and zero stock have no inventory value. Unknown prices remain unknown,
// rather than being counted as zero-valued inventory.
export function stockInventoryValue(stock: InventoryStock): number | null {
  if (stock.stock_quantity <= 0) return 0;
  if (stock.last_purchase_price_per_smallest_unit === null) return null;
  return Math.round(stock.stock_quantity * stock.last_purchase_price_per_smallest_unit);
}
