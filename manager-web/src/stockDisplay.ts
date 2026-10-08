import type { InventoryStock } from "./types";

// Ledger and stocktake quantities always remain in the smallest unit.
// The display uses the latest valid purchase unit, otherwise the configured
// default purchase unit; both name and factor come from the same source.
function preferredStockUnit(stock: InventoryStock): { name: string; factor: number } {
  if (stock.last_purchase_unit_name && stock.last_purchase_conversion_factor !== null &&
      Number.isFinite(stock.last_purchase_conversion_factor) &&
      stock.last_purchase_conversion_factor > 0) {
    return {
      name: stock.last_purchase_unit_name,
      factor: stock.last_purchase_conversion_factor
    };
  }
  if (stock.default_unit_name && Number.isFinite(stock.default_unit_conversion_factor) &&
      stock.default_unit_conversion_factor > 0) {
    return {
      name: stock.default_unit_name,
      factor: stock.default_unit_conversion_factor
    };
  }
  return { name: stock.smallest_unit_name, factor: 1 };
}

export function displayStockQuantity(stock: InventoryStock): number {
  return stock.stock_quantity / preferredStockUnit(stock).factor;
}

export function displayStockUnit(stock: InventoryStock): string {
  return preferredStockUnit(stock).name;
}

// Negative and zero stock have no inventory value. Unknown prices remain unknown,
// rather than being counted as zero-valued inventory.
export function stockInventoryValue(stock: InventoryStock): number | null {
  if (stock.stock_quantity <= 0) return 0;
  if (stock.last_purchase_price_per_smallest_unit === null) return null;
  return Math.round(stock.stock_quantity * stock.last_purchase_price_per_smallest_unit);
}
