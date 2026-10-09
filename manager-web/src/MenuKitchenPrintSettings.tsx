import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Input, message, Spin } from "antd";
import { getKitchenPrintMenuItems, saveKitchenPrintMenuItems } from "./api";
import type { KitchenPrintMenuItem } from "./types";
import "./MenuKitchenPrintSettings.css";

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();
}

export default function MenuKitchenPrintSettings({ inPos = false }: { inPos?: boolean }) {
  const [rows, setRows] = useState<KitchenPrintMenuItem[]>([]);
  const [original, setOriginal] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    let canceled = false;
    getKitchenPrintMenuItems().then((items) => {
      if (canceled) return;
      setRows(items);
      setOriginal(Object.fromEntries(items.map((row) => [row.id, row.print_to_kitchen])));
    }).catch((error) => {
      if (!canceled) messageApi.error(error instanceof Error
        ? error.message : "Không tải được danh sách món.");
    }).finally(() => {
      if (!canceled) setLoading(false);
    });
    return () => { canceled = true; };
  }, [messageApi]);

  const filtered = useMemo(() => {
    const query = normalizeSearch(search);
    return query ? rows.filter((item) => normalizeSearch(item.name).includes(query)) : rows;
  }, [rows, search]);
  const changed = rows.filter((row) => row.print_to_kitchen !== original[row.id]);
  const selectedCount = rows.filter((row) => row.print_to_kitchen).length;

  async function save() {
    if (!changed.length || saving) return;
    setSaving(true);
    try {
      const saved = await saveKitchenPrintMenuItems(
        changed.map((row) => ({
          menu_item_id: row.id,
          print_to_kitchen: row.print_to_kitchen
        }))
      );
      setRows(saved);
      setOriginal(Object.fromEntries(saved.map((row) => [row.id, row.print_to_kitchen])));
      messageApi.success("Đã lưu cấu hình in bếp cho " + changed.length + " món.");
    } catch (error) {
      messageApi.error(error instanceof Error
        ? error.message : "Không lưu được cấu hình in bếp.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={"menu-kitchen-print " + (inPos ? "menu-kitchen-print-pos" : "")}>
      {contextHolder}
      <div className="menu-kitchen-print-head">
        <div>
          <h2>Cấu hình in bếp</h2>
          <p>Chọn các món cần in phiếu chế biến ở bếp. Phiếu kiểm đồ vẫn có đầy đủ món.</p>
        </div>
        <span>{selectedCount}/{rows.length} món in bếp</span>
      </div>
      <Input.Search
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onSearch={setSearch}
        allowClear
        size="large"
        placeholder="Tìm món ăn, có thể gõ không dấu..."
      />
      <div className="menu-kitchen-print-labels">
        <strong>Tên món</strong><strong>In bếp</strong>
      </div>
      <div className="menu-kitchen-print-items">
        {loading
          ? <div className="menu-kitchen-print-empty"><Spin /> Đang tải thực đơn...</div>
          : filtered.length
            ? filtered.map((item) => (
              <label key={item.id} className="menu-kitchen-print-row">
                <span>{item.name}</span>
                <Checkbox
                  checked={item.print_to_kitchen}
                  disabled={saving}
                  onChange={(event) => setRows((current) => current.map((row) =>
                    row.id === item.id
                      ? { ...row, print_to_kitchen: event.target.checked }
                      : row
                  ))}
                  aria-label={"In bếp: " + item.name}
                />
              </label>
            ))
            : <div className="menu-kitchen-print-empty">Không có món phù hợp.</div>}
      </div>
      <div className="menu-kitchen-print-actions">
        <span>{changed.length ? changed.length + " thay đổi chưa lưu" : "Đã đồng bộ cấu hình"}</span>
        <Button type="primary" size="large"
          disabled={loading || saving || changed.length === 0}
          loading={saving} onClick={() => void save()}>
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
