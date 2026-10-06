package com.oc11.purchase;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.AutoCompleteTextView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

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
    protected void onCreate(Bundle savedInstanceState) {
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
                    LinearLayout actions = new LinearLayout(this);
                    actions.setOrientation(LinearLayout.HORIZONTAL);
                    actions.setGravity(Gravity.END);
                    actions.setPadding(0, dp(8), 0, 0);

                    Button edit = button("Sửa");
                    edit.setMinHeight(dp(40));
                    edit.setTextSize(14);
                    edit.setOnClickListener(v -> showReceiptForm(row));

                    Button delete = button("Xóa");
                    delete.setMinHeight(dp(40));
                    delete.setTextSize(14);
                    delete.setOnClickListener(v -> confirmDelete(row.id));

                    actions.addView(edit, new LinearLayout.LayoutParams(
                            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                    LinearLayout.LayoutParams deleteLp = new LinearLayout.LayoutParams(
                            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                    deleteLp.setMargins(dp(6), 0, 0, 0);
                    actions.addView(delete, deleteLp);
                    c.addView(actions);
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

    private void showReceiptForm(LocalStore.PendingReceipt editing) {
        JSONArray suppliers = LocalStore.asArray(store.getCache("suppliers"));
        JSONArray items = LocalStore.asArray(store.getCache("items"));
        JSONArray funds = LocalStore.asArray(store.getCache("fund_accounts"));

        if (suppliers.length() == 0 || items.length() == 0 || funds.length() == 0) {
            new AlertDialog.Builder(this)
                    .setTitle("Chưa có dữ liệu nền")
                    .setMessage("Lần đầu dùng app cần bấm Đồng bộ một lần để tải nhà cung cấp, hàng hóa và quỹ/tài khoản. Sau đó có thể nhập hàng hoàn toàn offline.")
                    .setPositiveButton("Đã hiểu", null)
                    .show();
            return;
        }

        JSONObject existing = null;
        if (editing != null) {
            try { existing = new JSONObject(editing.payload); } catch (Exception ignored) {}
        }

        LinearLayout form = vertical();
        form.setPadding(dp(14), dp(4), dp(14), dp(10));

        form.addView(text("Nhà cung cấp", 13, true));
        Spinner supplierSpinner = new Spinner(this);
        List<String> supplierNames = new ArrayList<>();
        List<Integer> supplierIds = new ArrayList<>();
        for (int i = 0; i < suppliers.length(); i++) {
            JSONObject s = suppliers.optJSONObject(i);
            if (s == null) continue;
            supplierNames.add(s.optString("name"));
            supplierIds.add(s.optInt("id"));
        }
        supplierSpinner.setAdapter(new ArrayAdapter<>(
                this,
                android.R.layout.simple_spinner_dropdown_item,
                supplierNames));
        form.addView(supplierSpinner);

        form.addView(spacer(8));
        form.addView(text("Trả tiền", 13, true));

        LinearLayout paymentRow = new LinearLayout(this);
        paymentRow.setOrientation(LinearLayout.HORIZONTAL);
        Button cashButton = button("Tiền mặt\nQuỹ đi chợ");
        Button bankButton = button("Chuyển khoản\nBIDV");
        cashButton.setTextSize(14);
        bankButton.setTextSize(14);
        paymentRow.addView(cashButton, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        LinearLayout.LayoutParams bankLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bankLp.setMargins(dp(6), 0, 0, 0);
        paymentRow.addView(bankButton, bankLp);
        form.addView(paymentRow);

        final String[] paymentType = new String[]{"CASH"};
        Runnable refreshPaymentButtons = () -> {
            boolean cash = "CASH".equals(paymentType[0]);
            cashButton.setEnabled(!cash);
            bankButton.setEnabled(cash);
            cashButton.setText(cash ? "✓ Tiền mặt\nQuỹ đi chợ" : "Tiền mặt\nQuỹ đi chợ");
            bankButton.setText(!cash ? "✓ Chuyển khoản\nBIDV" : "Chuyển khoản\nBIDV");
        };
        cashButton.setOnClickListener(v -> {
            paymentType[0] = "CASH";
            refreshPaymentButtons.run();
        });
        bankButton.setOnClickListener(v -> {
            paymentType[0] = "BANK";
            refreshPaymentButtons.run();
        });

        form.addView(spacer(12));

        final JSONArray lines = new JSONArray();
        if (existing != null) {
            JSONArray src = existing.optJSONArray("items");
            if (src != null) {
                for (int i = 0; i < src.length(); i++) {
                    JSONObject line = src.optJSONObject(i);
                    if (line != null) lines.put(copyJson(line));
                }
            }
            JSONObject oldPayment = existing.optJSONObject("payment");
            if (oldPayment != null && "BANK".equals(oldPayment.optString("account_type"))) {
                paymentType[0] = "BANK";
            }
        }
        refreshPaymentButtons.run();

        LinearLayout goodsHeader = new LinearLayout(this);
        goodsHeader.setOrientation(LinearLayout.HORIZONTAL);
        goodsHeader.setGravity(Gravity.CENTER_VERTICAL);
        TextView goodsTitle = text("Hàng hóa", 15, true);
        TextView goodsCount = text("", 12, false);
        goodsCount.setGravity(Gravity.END);
        goodsCount.setTextColor(Color.DKGRAY);
        goodsHeader.addView(goodsTitle, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        goodsHeader.addView(goodsCount);
        form.addView(goodsHeader);
        form.addView(spacer(6));

        LinearLayout linesBox = vertical();
        form.addView(linesBox);

        Button addLine = button("+ Thêm hàng hóa");
        form.addView(addLine);
        form.addView(spacer(10));

        LinearLayout totalRow = new LinearLayout(this);
        totalRow.setOrientation(LinearLayout.HORIZONTAL);
        totalRow.setGravity(Gravity.CENTER_VERTICAL);
        totalRow.setPadding(dp(4), dp(10), dp(4), dp(10));
        TextView totalLabel = text("TỔNG TIỀN", 15, true);
        TextView totalText = text("0 đ", 21, true);
        totalText.setGravity(Gravity.END);
        totalRow.addView(totalLabel, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        totalRow.addView(totalText);
        form.addView(totalRow);

        final Runnable[] refreshLines = new Runnable[1];
        refreshLines[0] = () -> {
            renderLines(linesBox, lines, items, refreshLines[0]);
            goodsCount.setText(lines.length() + " mặt hàng");
            long total = 0;
            for (int i = 0; i < lines.length(); i++) {
                JSONObject line = lines.optJSONObject(i);
                if (line != null) {
                    total += Math.round(
                            line.optDouble("quantity", 0) *
                            line.optLong("unit_price", 0)
                    );
                }
            }
            totalText.setText(MONEY.format(total) + " đ");
        };
        addLine.setOnClickListener(v -> showLineDialog(items, lines, refreshLines[0]));

        if (existing != null) {
            selectId(supplierSpinner, supplierIds, existing.optInt("supplier_id"));
        }
        refreshLines[0].run();

        ScrollView sc = new ScrollView(this);
        sc.addView(form);

        JSONObject finalExisting = existing;
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(editing == null ? "Nhập hàng đi chợ" : "Sửa phiếu chưa đồng bộ")
                .setView(sc)
                .setNegativeButton("Hủy", null)
                .setPositiveButton("Lưu offline", null)
                .create();

        dialog.setOnShowListener(x -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                if (lines.length() == 0) throw new Exception("Chưa có hàng hóa.");
                if (supplierSpinner.getSelectedItemPosition() < 0) {
                    throw new Exception("Chưa chọn nhà cung cấp.");
                }

                JSONObject fund = findMarketFund(funds, paymentType[0]);
                if (fund == null) {
                    if ("CASH".equals(paymentType[0])) {
                        throw new Exception("Không tìm thấy Quỹ đi chợ. Hãy tạo quỹ này trên Ốc 11 rồi bấm Đồng bộ.");
                    }
                    throw new Exception("Không tìm thấy tài khoản BIDV. Hãy tạo tài khoản BIDV trên Ốc 11 rồi bấm Đồng bộ.");
                }

                JSONObject payload = finalExisting == null
                        ? new JSONObject()
                        : copyJson(finalExisting);
                if (!payload.has("client_sync_id")) {
                    payload.put("client_sync_id", UUID.randomUUID().toString());
                }
                payload.put(
                        "supplier_id",
                        supplierIds.get(supplierSpinner.getSelectedItemPosition())
                );
                if (!payload.has("receipt_time") || editing == null) {
                    payload.put("receipt_time", nowIso());
                }
                payload.put("description", JSONObject.NULL);
                payload.put("shipping_fee", 0);
                payload.put("replaces_receipt_id", JSONObject.NULL);
                payload.put("items", lines);
                payload.put("payment_status", "PAID");

                JSONObject pay = new JSONObject();
                pay.put("account_type", paymentType[0]);
                pay.put("fund_account_id", fund.optInt("id"));
                payload.put("payment", pay);

                if (editing == null) store.saveReceipt(payload, nowIso());
                else store.updateReceipt(editing.id, payload);

                dialog.dismiss();
                refreshHome();
                Toast.makeText(
                        this,
                        "Đã lưu trên điện thoại. Chưa gửi lên máy tính.",
                        Toast.LENGTH_SHORT
                ).show();
            } catch (Exception ex) {
                Toast.makeText(this, ex.getMessage(), Toast.LENGTH_LONG).show();
            }
        }));
        dialog.show();
    }

    private void renderLines(LinearLayout box, JSONArray lines, JSONArray items, Runnable afterChange) {
        box.removeAllViews();
        for (int i = 0; i < lines.length(); i++) {
            JSONObject line = lines.optJSONObject(i);
            if (line == null) continue;
            int index = i;

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(10), dp(8), dp(6), dp(8));

            android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
            bg.setColor(Color.WHITE);
            bg.setCornerRadius(dp(10));
            bg.setStroke(dp(1), Color.rgb(225, 230, 235));
            row.setBackground(bg);

            LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            rowLp.setMargins(0, 0, 0, dp(7));
            row.setLayoutParams(rowLp);

            String itemName = itemName(items, line.optInt("item_id"));
            String unitName = unitName(items, line.optInt("item_id"), line.optInt("unit_id"));
            double qty = line.optDouble("quantity", 0);
            long price = line.optLong("unit_price", 0);
            long lineTotal = Math.round(qty * price);

            LinearLayout itemInfo = vertical();
            itemInfo.addView(text(itemName, 14, true));
            TextView detail = text(trimNumber(qty) + " " + unitName + " × " + MONEY.format(price) + " đ", 12, false);
            detail.setTextColor(Color.DKGRAY);
            itemInfo.addView(detail);
            row.addView(itemInfo, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            TextView amount = text(MONEY.format(lineTotal) + " đ", 14, true);
            amount.setGravity(Gravity.END);
            LinearLayout.LayoutParams amountLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            amountLp.setMargins(dp(8), 0, dp(4), 0);
            row.addView(amount, amountLp);

            Button remove = button("×");
            remove.setTextSize(22);
            remove.setMinWidth(dp(42));
            remove.setMinimumWidth(dp(42));
            remove.setMinHeight(dp(42));
            remove.setMinimumHeight(dp(42));
            remove.setPadding(0, 0, 0, 0);
            remove.setOnClickListener(v -> {
                JSONArray next = new JSONArray();
                for (int j = 0; j < lines.length(); j++) if (j != index) next.put(lines.opt(j));
                while (lines.length() > 0) lines.remove(lines.length() - 1);
                for (int j = 0; j < next.length(); j++) lines.put(next.opt(j));
                afterChange.run();
            });
            row.addView(remove, new LinearLayout.LayoutParams(dp(44), dp(44)));

            box.addView(row);
        }
    }

    private void showLineDialog(JSONArray items, JSONArray lines, Runnable afterAdd) {
        JSONArray inventory = LocalStore.asArray(store.getCache("inventory"));

        LinearLayout form = vertical();
        form.setPadding(dp(16), dp(4), dp(16), dp(8));
        AutoCompleteTextView itemInput = new AutoCompleteTextView(this);
        itemInput.setSingleLine(true);
        itemInput.setHint("Gõ tên hàng hóa...");
        itemInput.setThreshold(0);
        List<String> itemNames = new ArrayList<>();
        List<JSONObject> activeItems = new ArrayList<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null || !it.optBoolean("is_active", true)) continue;
            activeItems.add(it);
            itemNames.add(it.optString("name"));
        }
        itemInput.setAdapter(new ArrayAdapter<>(
                this,
                android.R.layout.simple_dropdown_item_1line,
                itemNames));
        itemInput.setOnClickListener(v -> itemInput.showDropDown());
        form.addView(text("Hàng hóa", 13, true));
        form.addView(itemInput);

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
        final JSONObject[] selectedItem = new JSONObject[]{null};

        Runnable refreshItem = () -> {
            JSONObject item = selectedItem[0];
            unitIds.clear();
            if (item == null) {
                unitSpinner.setAdapter(new ArrayAdapter<>(
                        this,
                        android.R.layout.simple_spinner_dropdown_item,
                        new ArrayList<String>()));
                info.setText("Gõ tên hàng hóa rồi chọn trong danh sách.");
                price.setText("");
                return;
            }

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
            unitSpinner.setAdapter(new ArrayAdapter<>(
                    this,
                    android.R.layout.simple_spinner_dropdown_item,
                    unitNames));

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

        itemInput.setOnItemClickListener((parent, view, position, id) -> {
            String chosenName = String.valueOf(parent.getItemAtPosition(position));
            selectedItem[0] = findItemByName(activeItems, chosenName);
            refreshItem.run();
        });

        itemInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                JSONObject chosen = selectedItem[0];
                if (chosen != null && !chosen.optString("name").equalsIgnoreCase(s.toString().trim())) {
                    selectedItem[0] = null;
                    refreshItem.run();
                }
            }
            @Override public void afterTextChanged(Editable s) {}
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
                JSONObject item = selectedItem[0];
                if (item == null) {
                    item = findItemByName(activeItems, itemInput.getText().toString());
                    selectedItem[0] = item;
                    if (item != null) refreshItem.run();
                }
                if (item == null) throw new Exception("Hãy chọn hàng hóa trong danh sách gợi ý.");
                if (unitIds.isEmpty() || unitSpinner.getSelectedItemPosition() < 0) throw new Exception("Hàng hóa chưa có đơn vị nhập.");
                double q = Double.parseDouble(qty.getText().toString().trim().replace(",", "."));
                if (q <= 0) throw new Exception("Số lượng phải lớn hơn 0.");
                long p = parseLong(price.getText().toString());
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

    private JSONObject findMarketFund(JSONArray funds, String type) {
        JSONObject fallback = null;
        for (int i = 0; i < funds.length(); i++) {
            JSONObject fund = funds.optJSONObject(i);
            if (fund == null || !fund.optBoolean("is_active", true)) continue;
            if (!type.equals(fund.optString("type"))) continue;

            String name = fund.optString("name", "").trim().toLowerCase(viLocale());
            String bankName = fund.optString("bank_name", "").trim().toLowerCase(viLocale());

            if ("CASH".equals(type)) {
                if (name.equals("quỹ đi chợ") || name.contains("đi chợ")) return fund;
            } else {
                if (name.contains("bidv") || bankName.contains("bidv")) return fund;
            }

            if (fallback == null) fallback = fund;
        }
        return null;
    }

    private Locale viLocale() {
        return new Locale("vi", "VN");
    }

    private JSONObject findItemByName(List<JSONObject> items, String name) {
        String wanted = name == null ? "" : name.trim();
        for (JSONObject item : items) {
            if (item.optString("name").equalsIgnoreCase(wanted)) return item;
        }
        return null;
    }

    private JSONObject findInventory(JSONArray inventory, int itemId) {
        for (int i = 0; i < inventory.length(); i++) {
            JSONObject row = inventory.optJSONObject(i);
            if (row != null && row.optInt("item_id") == itemId) return row;
        }
        return null;
    }

    private long totalOf(JSONObject p) {
        long total = 0;
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
