package com.oc11.purchase;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import android.app.Activity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String PREFS = "oc11_mobile_prefs";
    private static final String KEY_API_URL = "api_url";
    private static final DecimalFormat MONEY = new DecimalFormat("#,###");

    private LocalStore store;
    private SharedPreferences prefs;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private TextView connectionText;
    private TextView pendingText;
    private LinearLayout receiptList;
    private Button syncButton;

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, float sizeSp, boolean bold) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(sizeSp);
        v.setTextColor(Color.rgb(25, 35, 45));
        if (bold) v.setTypeface(null, android.graphics.Typeface.BOLD);
        return v;
    }

    private Button button(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(15);
        b.setMinHeight(dp(48));
        return b;
    }

    private View spacer(int heightDp) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(heightDp)));
        return v;
    }

    private LinearLayout vertical() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    private LinearLayout card() {
        LinearLayout l = vertical();
        l.setPadding(dp(14), dp(12), dp(14), dp(12));
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), Color.rgb(225, 230, 235));
        l.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(10));
        l.setLayoutParams(lp);
        return l;
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new LocalStore(this);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        buildHome();
        refreshHome();
    }

    private void buildHome() {
        LinearLayout root = vertical();
        root.setPadding(dp(16), dp(18), dp(16), dp(20));
        root.setBackgroundColor(Color.rgb(247, 248, 250));

        TextView title = text("ỐC 11 • NHẬP HÀNG", 22, true);
        root.addView(title);
        TextView subtitle = text("Làm việc offline • Chỉ đồng bộ khi bạn bấm", 13, false);
        subtitle.setTextColor(Color.DKGRAY);
        root.addView(subtitle);
        root.addView(spacer(14));

        LinearLayout status = card();
        connectionText = text("", 14, true);
        pendingText = text("", 14, false);
        status.addView(connectionText);
        status.addView(spacer(4));
        status.addView(pendingText);
        root.addView(status);

        Button addButton = button("+ Tạo phiếu nhập");
        addButton.setOnClickListener(v -> showReceiptForm(null));
        root.addView(addButton);

        syncButton = button("⟳ Đồng bộ với máy tính");
        syncButton.setOnClickListener(v -> syncManually());
        root.addView(syncButton);

        Button settingsButton = button("⚙ Cấu hình kết nối");
        settingsButton.setOnClickListener(v -> showSettings());
        root.addView(settingsButton);

        root.addView(spacer(14));
        root.addView(text("Phiếu trên điện thoại", 17, true));
        root.addView(spacer(8));

        receiptList = vertical();
        root.addView(receiptList);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
    }

    private void refreshHome() {
        int pending = store.pendingCount();
        String updated = store.getCacheUpdatedAt("items");
        String api = prefs.getString(KEY_API_URL, "");
        connectionText.setText(api.isEmpty() ? "Chưa cấu hình máy tính" : "Máy tính: " + api);
        pendingText.setText("Chờ đồng bộ: " + pending + " phiếu" +
                (updated == null ? " • Chưa tải dữ liệu nền" : " • Dữ liệu nền: " + updated));

        receiptList.removeAllViews();
        List<LocalStore.PendingReceipt> rows = store.listReceipts();
        if (rows.isEmpty()) {
            TextView empty = text("Chưa có phiếu nhập trên điện thoại.", 14, false);
            empty.setPadding(0, dp(10), 0, dp(10));
            receiptList.addView(empty);
            return;
        }

        int shown = 0;
        for (LocalStore.PendingReceipt row : rows) {
            if (shown++ >= 40) break;
            try {
                JSONObject p = new JSONObject(row.payload);
                LinearLayout c = card();
                String supplier = supplierName(p.optInt("supplier_id"));
                long total = totalOf(p);
                String state = row.synced == 1
                        ? "✓ Đã đồng bộ" + (row.serverCode == null ? "" : " • " + row.serverCode)
                        : (row.error == null ? "● Chờ đồng bộ" : "! Lỗi đồng bộ");
                TextView h = text(supplier + "  •  " + MONEY.format(total) + " đ", 16, true);
                TextView t = text(formatReceiptTime(p.optString("receipt_time")) + "  •  " + state, 13, false);
                if (row.synced == 0) t.setTextColor(row.error == null ? Color.rgb(178, 115, 0) : Color.rgb(190, 40, 40));
                else t.setTextColor(Color.rgb(32, 130, 70));
                c.addView(h);
                c.addView(spacer(4));
                c.addView(t);
                if (row.error != null) {
                    TextView err = text(row.error, 12, false);
                    err.setTextColor(Color.rgb(165, 45, 45));
                    c.addView(err);
                }
                if (row.synced == 0) {
                    TextView hint = text("Chạm để sửa • Giữ để xóa", 11, false);
                    hint.setTextColor(Color.GRAY);
                    hint.setPadding(0, dp(7), 0, 0);
                    c.addView(hint);
                    c.setOnClickListener(v -> showReceiptForm(row));
                    c.setOnLongClickListener(v -> {
                        confirmDelete(row.id);
                        return true;
                    });
                }
                receiptList.addView(c);
            } catch (Exception ignored) {}
        }
    }

    private void showSettings() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("Ví dụ: http://192.168.1.50:8000");
        input.setText(prefs.getString(KEY_API_URL, ""));
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setPadding(dp(16), dp(8), dp(16), dp(8));

        new AlertDialog.Builder(this)
                .setTitle("Kết nối máy tính Ốc 11")
                .setMessage("Nhập địa chỉ API của máy tính. App không tự kết nối nền; địa chỉ này chỉ được dùng khi bạn bấm Đồng bộ.")
                .setView(input)
                .setNegativeButton("Hủy", null)
                .setPositiveButton("Lưu", (d, w) -> {
                    String value = ApiClient.normalizeBaseUrl(input.getText().toString());
                    prefs.edit().putString(KEY_API_URL, value).apply();
                    refreshHome();
                })
                .show();
    }

    private void confirmDelete(long id) {
        new AlertDialog.Builder(this)
                .setTitle("Xóa phiếu chưa đồng bộ?")
                .setMessage("Phiếu chỉ đang nằm trên điện thoại nên có thể xóa an toàn.")
                .setNegativeButton("Không", null)
                .setPositiveButton("Xóa", (d, w) -> {
                    store.deleteUnsynced(id);
                    refreshHome();
                })
                .show();
    }

    private void syncManually() {
        String baseUrl = prefs.getString(KEY_API_URL, "").trim();
        if (baseUrl.isEmpty()) {
            Toast.makeText(this, "Hãy cấu hình địa chỉ máy tính trước.", Toast.LENGTH_LONG).show();
            showSettings();
            return;
        }

        syncButton.setEnabled(false);
        syncButton.setText("Đang đồng bộ…");

        io.execute(() -> {
            int uploaded = 0;
            int failed = 0;
            String fatal = null;
            try {
                JSONObject health = ApiClient.getObject(baseUrl, "/api/health");
                if (!"ok".equalsIgnoreCase(health.optString("status"))) {
                    throw new Exception("API máy tính không sẵn sàng.");
                }

                for (LocalStore.PendingReceipt row : store.listUnsynced()) {
                    try {
                        JSONObject response = ApiClient.postObject(
                                baseUrl, "/api/purchase-receipts", new JSONObject(row.payload));
                        store.markSynced(row.id, response.optString("receipt_code", null));
                        uploaded++;
                    } catch (Exception ex) {
                        store.markError(row.id, ex.getMessage());
                        failed++;
                    }
                }

                String stamp = nowDisplay();
                store.putCache("suppliers", ApiClient.getArray(baseUrl, "/api/suppliers").toString(), stamp);
                store.putCache("items", ApiClient.getArray(baseUrl, "/api/items").toString(), stamp);
                store.putCache("fund_accounts", ApiClient.getArray(baseUrl, "/api/fund-accounts").toString(), stamp);
                store.putCache("item_groups", ApiClient.getArray(baseUrl, "/api/item-groups").toString(), stamp);
                store.putCache("inventory", ApiClient.getArray(baseUrl, "/api/inventory/stock").toString(), stamp);
            } catch (Exception ex) {
                fatal = ex.getMessage();
            }

            final int okCount = uploaded;
            final int failCount = failed;
            final String fatalMessage = fatal;
            runOnUiThread(() -> {
                syncButton.setEnabled(true);
                syncButton.setText("⟳ Đồng bộ với máy tính");
                refreshHome();
                if (fatalMessage != null) {
                    Toast.makeText(this, "Không đồng bộ được: " + fatalMessage, Toast.LENGTH_LONG).show();
                } else {
                    String msg = "Đồng bộ xong: " + okCount + " phiếu";
                    if (failCount > 0) msg += ", lỗi " + failCount;
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                }
            });
        });
    }

    private void showReceiptForm(@Nullable LocalStore.PendingReceipt editing) {
        JSONArray suppliers = LocalStore.asArray(store.getCache("suppliers"));
        JSONArray items = LocalStore.asArray(store.getCache("items"));
        JSONArray funds = LocalStore.asArray(store.getCache("fund_accounts"));

        if (suppliers.length() == 0 || items.length() == 0) {
            new AlertDialog.Builder(this)
                    .setTitle("Chưa có dữ liệu nền")
                    .setMessage("Lần đầu dùng app cần bấm Đồng bộ một lần để tải danh sách hàng hóa, nhà cung cấp, đơn vị và quỹ. Sau đó có thể nhập hàng hoàn toàn offline.")
                    .setPositiveButton("Đã hiểu", null)
                    .show();
            return;
        }

        JSONObject existing = null;
        if (editing != null) {
            try { existing = new JSONObject(editing.payload); } catch (Exception ignored) {}
        }

        LinearLayout form = vertical();
        form.setPadding(dp(16), dp(4), dp(16), dp(12));

        TextView supplierLabel = text("Nhà cung cấp", 13, true);
        Spinner supplierSpinner = new Spinner(this);
        List<String> supplierNames = new ArrayList<>();
        List<Integer> supplierIds = new ArrayList<>();
        for (int i = 0; i < suppliers.length(); i++) {
            JSONObject s = suppliers.optJSONObject(i);
            if (s == null) continue;
            supplierNames.add(s.optString("name"));
            supplierIds.add(s.optInt("id"));
        }
        supplierSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, supplierNames));
        form.addView(supplierLabel);
        form.addView(supplierSpinner);

        form.addView(spacer(8));
        form.addView(text("Thanh toán", 13, true));
        Spinner paymentSpinner = new Spinner(this);
        paymentSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
                new String[]{"Đã thanh toán", "Trả nợ"}));
        form.addView(paymentSpinner);

        form.addView(text("Loại tiền", 13, true));
        Spinner moneyType = new Spinner(this);
        moneyType.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
                new String[]{"Tiền mặt", "Ngân hàng"}));
        form.addView(moneyType);

        form.addView(text("Quỹ / tài khoản", 13, true));
        Spinner fundSpinner = new Spinner(this);
        form.addView(fundSpinner);

        EditText shipping = new EditText(this);
        shipping.setHint("Phí vận chuyển");
        shipping.setInputType(InputType.TYPE_CLASS_NUMBER);
        form.addView(shipping);

        EditText note = new EditText(this);
        note.setHint("Ghi chú");
        note.setSingleLine(false);
        form.addView(note);

        form.addView(spacer(8));
        TextView linesTitle = text("Hàng hóa", 15, true);
        form.addView(linesTitle);
        LinearLayout linesBox = vertical();
        form.addView(linesBox);

        final JSONArray lines = new JSONArray();
        if (existing != null) {
            JSONArray src = existing.optJSONArray("items");
            if (src != null) {
                for (int i = 0; i < src.length(); i++) {
                    JSONObject line = src.optJSONObject(i);
                    if (line != null) lines.put(copyJson(line));
                }
            }
        }

        Button addLine = button("+ Thêm hàng hóa");
        form.addView(addLine);

        Runnable refreshLines = () -> renderLines(linesBox, lines, items);
        addLine.setOnClickListener(v -> showLineDialog(items, lines, refreshLines));
        refreshLines.run();

        final Runnable refreshFunds = () -> {
            boolean bank = moneyType.getSelectedItemPosition() == 1;
            String desired = bank ? "BANK" : "CASH";
            List<String> names = new ArrayList<>();
            List<Integer> ids = new ArrayList<>();
            for (int i = 0; i < funds.length(); i++) {
                JSONObject f = funds.optJSONObject(i);
                if (f == null || !f.optBoolean("is_active", true)) continue;
                if (!desired.equals(f.optString("type"))) continue;
                names.add(f.optString("name") + " • " + MONEY.format(f.optLong("current_balance")) + " đ");
                ids.add(f.optInt("id"));
            }
            fundSpinner.setTag(ids);
            fundSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names));
        };
        moneyType.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { refreshFunds.run(); }
            @Override public void onNothingSelected(AdapterView<?> parent) {}
        });
        paymentSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                boolean paid = pos == 0;
                moneyType.setEnabled(paid);
                fundSpinner.setEnabled(paid);
            }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });
        refreshFunds.run();

        if (existing != null) {
            selectId(supplierSpinner, supplierIds, existing.optInt("supplier_id"));
            shipping.setText(String.valueOf(existing.optLong("shipping_fee", 0)));
            note.setText(existing.optString("description", ""));
            boolean debt = "DEBT".equals(existing.optString("payment_status"));
            paymentSpinner.setSelection(debt ? 1 : 0);
            JSONObject pay = existing.optJSONObject("payment");
            if (pay != null) {
                boolean bank = "BANK".equals(pay.optString("account_type"));
                moneyType.setSelection(bank ? 1 : 0);
                refreshFunds.run();
                Object tag = fundSpinner.getTag();
                if (tag instanceof List) {
                    @SuppressWarnings("unchecked")
                    List<Integer> ids = (List<Integer>) tag;
                    selectId(fundSpinner, ids, pay.optInt("fund_account_id"));
                }
            }
        }

        ScrollView sc = new ScrollView(this);
        sc.addView(form);

        JSONObject finalExisting = existing;
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(editing == null ? "Tạo phiếu nhập" : "Sửa phiếu chưa đồng bộ")
                .setView(sc)
                .setNegativeButton("Hủy", null)
                .setPositiveButton("Lưu offline", null)
                .create();

        dialog.setOnShowListener(x -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                if (lines.length() == 0) throw new Exception("Chưa có hàng hóa.");
                if (supplierSpinner.getSelectedItemPosition() < 0) throw new Exception("Chưa chọn nhà cung cấp.");

                JSONObject payload = finalExisting == null ? new JSONObject() : copyJson(finalExisting);
                if (!payload.has("client_sync_id")) payload.put("client_sync_id", UUID.randomUUID().toString());
                payload.put("supplier_id", supplierIds.get(supplierSpinner.getSelectedItemPosition()));
                if (!payload.has("receipt_time") || editing == null) payload.put("receipt_time", nowIso());
                payload.put("description", note.getText().toString().trim());
                payload.put("shipping_fee", parseLong(shipping.getText().toString()));
                payload.put("replaces_receipt_id", JSONObject.NULL);
                payload.put("items", lines);

                if (paymentSpinner.getSelectedItemPosition() == 0) {
                    @SuppressWarnings("unchecked")
                    List<Integer> fundIds = (List<Integer>) fundSpinner.getTag();
                    if (fundIds == null || fundIds.isEmpty() || fundSpinner.getSelectedItemPosition() < 0) {
                        throw new Exception("Chưa có quỹ/tài khoản phù hợp.");
                    }
                    payload.put("payment_status", "PAID");
                    JSONObject pay = new JSONObject();
                    pay.put("account_type", moneyType.getSelectedItemPosition() == 1 ? "BANK" : "CASH");
                    pay.put("fund_account_id", fundIds.get(fundSpinner.getSelectedItemPosition()));
                    payload.put("payment", pay);
                } else {
                    payload.put("payment_status", "DEBT");
                    payload.put("payment", JSONObject.NULL);
                }

                if (editing == null) store.saveReceipt(payload, nowIso());
                else store.updateReceipt(editing.id, payload);

                dialog.dismiss();
                refreshHome();
                Toast.makeText(this, "Đã lưu trên điện thoại. Chưa gửi lên máy tính.", Toast.LENGTH_SHORT).show();
            } catch (Exception ex) {
                Toast.makeText(this, ex.getMessage(), Toast.LENGTH_LONG).show();
            }
        }));
        dialog.show();
    }

    private void renderLines(LinearLayout box, JSONArray lines, JSONArray items) {
        box.removeAllViews();
        for (int i = 0; i < lines.length(); i++) {
            JSONObject line = lines.optJSONObject(i);
            if (line == null) continue;
            int index = i;
            LinearLayout c = card();
            String itemName = itemName(items, line.optInt("item_id"));
            String unitName = unitName(items, line.optInt("item_id"), line.optInt("unit_id"));
            double qty = line.optDouble("quantity", 0);
            long price = line.optLong("unit_price", 0);
            c.addView(text(itemName, 14, true));
            c.addView(text(trimNumber(qty) + " " + unitName + " × " + MONEY.format(price) + " đ", 13, false));
            Button remove = button("Xóa dòng");
            remove.setOnClickListener(v -> {
                JSONArray next = new JSONArray();
                for (int j = 0; j < lines.length(); j++) if (j != index) next.put(lines.opt(j));
                while (lines.length() > 0) lines.remove(lines.length() - 1);
                for (int j = 0; j < next.length(); j++) lines.put(next.opt(j));
                renderLines(box, lines, items);
            });
            c.addView(remove);
            box.addView(c);
        }
    }

    private void showLineDialog(JSONArray items, JSONArray lines, Runnable afterAdd) {
        JSONArray inventory = LocalStore.asArray(store.getCache("inventory"));

        LinearLayout form = vertical();
        form.setPadding(dp(16), dp(4), dp(16), dp(8));
        Spinner itemSpinner = new Spinner(this);
        List<String> itemNames = new ArrayList<>();
        List<JSONObject> activeItems = new ArrayList<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null || !it.optBoolean("is_active", true)) continue;
            activeItems.add(it);
            itemNames.add(it.optString("name"));
        }
        itemSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, itemNames));
        form.addView(text("Hàng hóa", 13, true));
        form.addView(itemSpinner);

        TextView info = text("", 12, false);
        info.setTextColor(Color.DKGRAY);
        form.addView(info);

        Spinner unitSpinner = new Spinner(this);
        form.addView(text("Đơn vị nhập", 13, true));
        form.addView(unitSpinner);

        EditText qty = new EditText(this);
        qty.setHint("Số lượng");
        qty.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        form.addView(qty);

        EditText price = new EditText(this);
        price.setHint("Đơn giá");
        price.setInputType(InputType.TYPE_CLASS_NUMBER);
        form.addView(price);

        final List<Integer> unitIds = new ArrayList<>();

        Runnable refreshItem = () -> {
            if (activeItems.isEmpty()) return;
            JSONObject item = activeItems.get(itemSpinner.getSelectedItemPosition());
            unitIds.clear();
            List<String> unitNames = new ArrayList<>();
            JSONArray conversions = item.optJSONArray("conversions");
            if (conversions != null) {
                for (int i = 0; i < conversions.length(); i++) {
                    JSONObject c = conversions.optJSONObject(i);
                    if (c == null || !c.optBoolean("is_active", true)) continue;
                    unitIds.add(c.optInt("unit_id"));
                    unitNames.add(c.optString("unit_name"));
                }
            }
            unitSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, unitNames));

            JSONObject stock = findInventory(inventory, item.optInt("id"));
            if (stock != null) {
                String msg = "Tồn trước: " + trimNumber(stock.optDouble("stock_quantity", 0)) + " " +
                        stock.optString("smallest_unit_name");
                long last = stock.optLong("last_purchase_unit_price", -1);
                if (last >= 0) msg += " • Giá gần nhất: " + MONEY.format(last) + " đ";
                info.setText(msg);
                int lastUnitId = stock.optInt("last_purchase_unit_id", -1);
                int idx = unitIds.indexOf(lastUnitId);
                if (idx >= 0) unitSpinner.setSelection(idx);
                if (last >= 0) price.setText(String.valueOf(last));
            } else {
                info.setText("Chưa có dữ liệu tồn / giá gần nhất.");
            }
        };
        itemSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) { refreshItem.run(); }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });
        refreshItem.run();

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Thêm hàng hóa")
                .setView(form)
                .setNegativeButton("Hủy", null)
                .setPositiveButton("Thêm", null)
                .create();

        dialog.setOnShowListener(x -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                if (activeItems.isEmpty()) throw new Exception("Không có hàng hóa.");
                if (unitIds.isEmpty() || unitSpinner.getSelectedItemPosition() < 0) throw new Exception("Hàng hóa chưa có đơn vị nhập.");
                double q = Double.parseDouble(qty.getText().toString().trim().replace(",", "."));
                if (q <= 0) throw new Exception("Số lượng phải lớn hơn 0.");
                long p = parseLong(price.getText().toString());
                JSONObject item = activeItems.get(itemSpinner.getSelectedItemPosition());
                JSONObject line = new JSONObject();
                line.put("item_id", item.optInt("id"));
                line.put("unit_id", unitIds.get(unitSpinner.getSelectedItemPosition()));
                line.put("quantity", q);
                line.put("unit_price", p);
                line.put("note", JSONObject.NULL);
                lines.put(line);
                dialog.dismiss();
                afterAdd.run();
            } catch (Exception ex) {
                Toast.makeText(this, "Kiểm tra lại số lượng / đơn giá.", Toast.LENGTH_LONG).show();
            }
        }));
        dialog.show();
    }

    private JSONObject findInventory(JSONArray inventory, int itemId) {
        for (int i = 0; i < inventory.length(); i++) {
            JSONObject row = inventory.optJSONObject(i);
            if (row != null && row.optInt("item_id") == itemId) return row;
        }
        return null;
    }

    private long totalOf(JSONObject p) {
        long total = p.optLong("shipping_fee", 0);
        JSONArray lines = p.optJSONArray("items");
        if (lines != null) {
            for (int i = 0; i < lines.length(); i++) {
                JSONObject l = lines.optJSONObject(i);
                if (l != null) total += Math.round(l.optDouble("quantity", 0) * l.optLong("unit_price", 0));
            }
        }
        return total;
    }

    private String supplierName(int id) {
        JSONArray arr = LocalStore.asArray(store.getCache("suppliers"));
        for (int i = 0; i < arr.length(); i++) {
            JSONObject s = arr.optJSONObject(i);
            if (s != null && s.optInt("id") == id) return s.optString("name");
        }
        return "Nhà cung cấp #" + id;
    }

    private String itemName(JSONArray items, int id) {
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it != null && it.optInt("id") == id) return it.optString("name");
        }
        return "Hàng #" + id;
    }

    private String unitName(JSONArray items, int itemId, int unitId) {
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null || it.optInt("id") != itemId) continue;
            JSONArray a = it.optJSONArray("conversions");
            if (a == null) break;
            for (int j = 0; j < a.length(); j++) {
                JSONObject c = a.optJSONObject(j);
                if (c != null && c.optInt("unit_id") == unitId) return c.optString("unit_name");
            }
        }
        return "";
    }

    private static JSONObject copyJson(JSONObject source) {
        try { return new JSONObject(source.toString()); }
        catch (Exception e) { return new JSONObject(); }
    }

    private static long parseLong(String value) {
        String s = value == null ? "" : value.replace(".", "").replace(",", "").replace(" ", "").trim();
        if (s.isEmpty()) return 0;
        return Long.parseLong(s);
    }

    private static String nowIso() {
        return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(new Date());
    }

    private static String nowDisplay() {
        return new SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(new Date());
    }

    private static String formatReceiptTime(String iso) {
        if (iso == null || iso.length() < 10) return iso == null ? "" : iso;
        try {
            Date d = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).parse(iso);
            return new SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault()).format(d);
        } catch (Exception e) {
            return iso;
        }
    }

    private static String trimNumber(double value) {
        if (Math.abs(value - Math.rint(value)) < 1e-9) return String.valueOf((long) Math.rint(value));
        return new DecimalFormat("0.###").format(value);
    }

    private static void selectId(Spinner spinner, List<Integer> ids, int id) {
        int index = ids.indexOf(id);
        if (index >= 0) spinner.setSelection(index);
    }
}
