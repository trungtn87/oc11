import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Input, InputNumber, message, Modal, Segmented, Spin } from "antd";
import {
  getPosPrintTemplates,
  previewPosPrintTemplate,
  resetPosPrintTemplate,
  savePosPrintTemplate,
  testPosPrintTemplate
} from "./api";
import type { PosPrintTemplate, PosPrintTemplateKind } from "./types";
import "./PosPrintTemplateEditor.css";

const names: Record<PosPrintTemplateKind, string> = {
  KITCHEN: "In bếp",
  CHECK: "Kiểm đồ",
  ESTIMATE: "Tạm tính",
  RECEIPT: "Thanh toán"
};
const titles: Record<PosPrintTemplateKind, string> = {
  KITCHEN: "CHẾ BIẾN",
  CHECK: "KIỂM ĐỒ",
  ESTIMATE: "PHIẾU TẠM TÍNH",
  RECEIPT: "PHIẾU THANH TOÁN"
};
const fields: Array<{key: keyof PosPrintTemplate; label: string}> = [
  { key: "show_shop_name", label: "Tên quán" },
  { key: "show_phone", label: "Số điện thoại" },
  { key: "show_address", label: "Địa chỉ" },
  { key: "show_table", label: "Bàn / khu vực" },
  { key: "show_time", label: "Thời gian" },
  { key: "show_options", label: "Kiểu chế biến" },
  { key: "show_notes", label: "Ghi chú món / bếp" },
  { key: "show_surcharges", label: "Phụ thu" },
  { key: "show_prices", label: "Đơn giá" },
  { key: "show_payment", label: "Hình thức thanh toán" },
  { key: "show_footer", label: "Lời nhắn cuối phiếu" }
];

function isFinancial(kind: PosPrintTemplateKind) {
  return kind === "ESTIMATE" || kind === "RECEIPT";
}

export default function PosPrintTemplateEditor({ open }: { open: boolean }) {
  const [selected, setSelected] = useState<PosPrintTemplateKind>("ESTIMATE");
  const [templates, setTemplates] = useState<Record<PosPrintTemplateKind, PosPrintTemplate> | null>(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState<PosPrintTemplateKind[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const template = templates?.[selected];

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    setLoading(true);
    getPosPrintTemplates()
      .then((rows) => {
        if (!canceled) {
          setTemplates(rows);
          setDirty([]);
        }
      })
      .catch((error) => {
        if (!canceled) messageApi.error(error instanceof Error ? error.message : "Không tải được mẫu in.");
      })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [open, messageApi]);

  useEffect(() => {
    if (!open || !template) return;
    let canceled = false;
    setPreviewLoading(true);
    previewPosPrintTemplate(selected, template)
      .then((result) => { if (!canceled) setPreview(result.text); })
      .catch((error) => {
        if (!canceled) messageApi.error(error instanceof Error ? error.message : "Không xem trước được.");
      })
      .finally(() => { if (!canceled) setPreviewLoading(false); });
    return () => { canceled = true; };
  }, [open, selected, template, messageApi]);

  function edit<K extends keyof PosPrintTemplate>(field: K, value: PosPrintTemplate[K]) {
    setTemplates((current) => current ? {
      ...current,
      [selected]: { ...current[selected], [field]: value }
    } : current);
    setDirty((current) => current.includes(selected) ? current : [...current, selected]);
  }

  async function save() {
    if (!template) return;
    setSaving(true);
    try {
      const result = await savePosPrintTemplate(selected, template);
      setTemplates((old) => old ? { ...old, [selected]: result } : old);
      setDirty((old) => old.filter((kind) => kind !== selected));
      messageApi.success("Đã lưu mẫu " + names[selected] + ".");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không lưu được mẫu.");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    Modal.confirm({
      title: "Khôi phục mẫu mặc định?",
      content: "Chỉ mẫu " + names[selected] + " được đặt lại. Các mẫu khác giữ nguyên.",
      okText: "Khôi phục",
      cancelText: "Không",
      onOk: async () => {
        const result = await resetPosPrintTemplate(selected);
        setTemplates((old) => old ? { ...old, [selected]: result } : old);
        setDirty((old) => old.filter((kind) => kind !== selected));
        messageApi.success("Đã khôi phục mẫu mặc định.");
      }
    });
  }

  async function printSample() {
    if (!template) return;
    setTesting(true);
    try {
      const result = await testPosPrintTemplate(selected, template);
      if (result.ok) messageApi.success("Đã gửi mẫu thử tới " + result.printer_name + ".");
      else messageApi.error(result.error || "Máy in chưa nhận được phiếu.");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Không gửi được bản in thử.");
    } finally {
      setTesting(false);
    }
  }

  const financial = isFinancial(selected);
  const visibleFields = fields.filter(({ key }) =>
    (key !== "show_prices" || financial) &&
    (key !== "show_payment" || selected === "RECEIPT")
  );

  return (
    <div className="pos-print-template-editor">
      {contextHolder}
      <Segmented block value={selected}
        onChange={(value) => setSelected(value as PosPrintTemplateKind)}
        options={(Object.keys(names) as PosPrintTemplateKind[]).map((value) => ({
          label: names[value] + (dirty.includes(value) ? " *" : ""),
          value
        }))} />
      {loading || !template ? <div className="pos-template-loading"><Spin /> Đang tải mẫu phiếu...</div> : (
        <div className="pos-template-layout">
          <div className="pos-template-controls">
            <h3>Tùy chỉnh mẫu {names[selected].toLowerCase()}</h3>
            <p>Mỗi mẫu lưu riêng. Dấu * nghĩa là có thay đổi chưa lưu.</p>
            <label>Tiêu đề phiếu</label>
            <Input value={template.title_text} maxLength={80} placeholder={titles[selected]}
              onChange={(event) => edit("title_text", event.target.value)} />
            <div className="pos-template-sizes">
              <label>Chữ tiêu đề
                <InputNumber min={12} max={24} value={template.title_font_pt}
                  addonAfter="pt" onChange={(v) => v !== null && edit("title_font_pt", v)} />
              </label>
              <label>Chữ nội dung
                <InputNumber min={10} max={18} value={template.body_font_pt}
                  addonAfter="pt" onChange={(v) => v !== null && edit("body_font_pt", v)} />
              </label>
              {financial && <label>Chữ tổng tiền
                <InputNumber min={14} max={26} value={template.total_font_pt}
                  addonAfter="pt" onChange={(v) => v !== null && edit("total_font_pt", v)} />
              </label>}
              <label>Giãn dòng
                <InputNumber min={1} max={1.8} step={0.1} value={template.line_spacing}
                  onChange={(v) => v !== null && edit("line_spacing", v)} />
              </label>
              <label>Lề trái
                <InputNumber min={1} max={8} value={template.left_margin_mm}
                  addonAfter="mm" onChange={(v) => v !== null && edit("left_margin_mm", v)} />
              </label>
            </div>
            <h4>Thông tin xuất hiện trên phiếu</h4>
            <div className="pos-template-checkboxes">
              {visibleFields.map(({ key, label }) => (
                <Checkbox key={key} checked={Boolean(template[key])}
                  onChange={(event) => edit(key, event.target.checked)}>
                  {label}
                </Checkbox>
              ))}
            </div>
            <div className="pos-template-text-fields">
              <label>Tên quán
                <Input value={template.shop_name} maxLength={80}
                  onChange={(event) => edit("shop_name", event.target.value)} />
              </label>
              <label>Số điện thoại
                <Input value={template.shop_phone} maxLength={60}
                  placeholder="Số điện thoại in trên phiếu"
                  onChange={(event) => edit("shop_phone", event.target.value)} />
              </label>
              <label>Địa chỉ
                <Input value={template.shop_address} maxLength={180}
                  placeholder="Địa chỉ quán"
                  onChange={(event) => edit("shop_address", event.target.value)} />
              </label>
              <label>Lời nhắn cuối
                <Input.TextArea value={template.footer_text} maxLength={180}
                  autoSize={{ minRows: 1, maxRows: 2 }}
                  onChange={(event) => edit("footer_text", event.target.value)} />
              </label>
            </div>
          </div>
          <div className="pos-template-preview-pane">
            <div className="pos-template-preview-heading">
              <strong>Xem trước khổ giấy 80mm</strong>
              {previewLoading && <Spin size="small" />}
            </div>
            <div className="pos-template-paper">
              {preview.split(/\r?\n/).map((line, i) => {
                const normalized = line.trim();
                const titleLine = normalized === (template.title_text.trim() || titles[selected]);
                const totalLine = normalized.startsWith("TỔNG TIỀN:");
                const fontSize = titleLine ? template.title_font_pt
                  : totalLine ? template.total_font_pt : template.body_font_pt;
                return <div key={i} className={titleLine ? "pos-template-paper-title" : ""}
                  style={{
                    fontSize: fontSize + "pt",
                    fontWeight: titleLine || totalLine ? 700 : 400,
                    lineHeight: template.line_spacing * 1.3,
                    paddingLeft: template.left_margin_mm + "mm"
                  }}>{line || "\u00a0"}</div>;
              })}
            </div>
            <Alert type="info" showIcon
              message="Dữ liệu xem trước là dữ liệu mẫu, không tạo đơn hay trừ kho."
              description="Kích thước và ngắt dòng thực tế còn phụ thuộc driver máy in Windows." />
          </div>
        </div>
      )}
      <div className="pos-template-actions">
        <Button danger disabled={!template || saving} onClick={reset}>Khôi phục mặc định</Button>
        <Button disabled={!template || saving} loading={testing} onClick={() => void printSample()}>
          In thử mẫu
        </Button>
        <Button type="primary" disabled={!template || loading} loading={saving}
          onClick={() => void save()}>
          Lưu mẫu {names[selected]}
        </Button>
      </div>
    </div>
  );
}
