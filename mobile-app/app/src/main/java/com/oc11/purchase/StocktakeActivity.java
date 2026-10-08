package com.oc11.purchase;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** Offline stock count. Only explicitly typed quantities are submitted. */
public final class StocktakeActivity extends Activity {
    private static final DecimalFormat NUMBER = new DecimalFormat("0.###");

    private LocalStore store;
    private final List<JSONObject> stock = new ArrayList<>();
    private final Map<Integer, String> drafts = new HashMap<>();
    private LinearLayout stockContainer;
    private EditText search;
    private TextView countStatus;
    private Button filterButton;
    private boolean showAll = false;
    private boolean useFreshReference = false;
    private boolean hasRevisionData = true;
    private long editingId = -1;
    private JSONObject editingPayload = null;

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, int size, boolean bold) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(size);
        v.setTextColor(Color.rgb(35, 42, 50));
        if (bold) v.setTypeface(null, android.graphics.Typeface.BOLD);
        return v;
    }

    private Button button(String title) {
        Button v = new Button(this);
        v.setText(title);
        v.setAllCaps(false);
        v.setMinHeight(dp(46));
        return v;
    }

    private LinearLayout vertical() {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        return v;
    }

    private LinearLayout card() {
        LinearLayout v = vertical();
        v.setPadding(dp(12), dp(10), dp(12), dp(10));
        android.graphics.drawable.GradientDrawable bg =
                new android.graphics.drawable.GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(10));
        bg.setStroke(dp(1), Color.rgb(223, 228, 233));
        v.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(8));
        v.setLayoutParams(lp);
        return v;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = new LocalStore(this);

        JSONArray cached = LocalStore.asArray(store.getCache("inventory"));
        for (int i = 0; i < cached.length(); i++) {
            JSONObject row = cached.optJSONObject(i);
            if (row == null) continue;
            stock.add(row);
            if (!row.has("stock_revision") || !row.has("is_stock_tracked")) {
                hasRevisionData = false;
            }
        }
        stock.sort(Comparator
                .comparingDouble((JSONObject row) -> row.optDouble("stock_quantity", 0))
                .thenComparing(row -> row.optString("item_name", "").toLowerCase(Locale.ROOT)));

        editingId = getIntent().getLongExtra("stocktake_id", -1);
        if (editingId > 0) {
            for (LocalStore.PendingStocktake row : store.listUnsyncedStocktakes()) {
                if (row.id != editingId) continue;
                try {
                    editingPayload = new JSONObject(row.payload);
                    JSONArray lines = editingPayload.optJSONArray("items");
                    if (lines != null) {
                        for (int i = 0; i < lines.length(); i++) {
                            JSONObject line = lines.optJSONObject(i);
                            if (line != null) {
                                drafts.put(
                                        line.optInt("item_id"),
                                        String.valueOf(line.optDouble("actual_quantity")));
                            }
                        }
                    }
                } catch (Exception ignored) {}
                break;
            }
            if (editingPayload == null) editingId = -1;
        }
        buildScreen();
    }

    private void buildScreen() {
        LinearLayout root = vertical();
        root.setPadding(dp(14), dp(16), dp(14), dp(20));
        root.setBackgroundColor(Color.rgb(247, 248, 250));

        Button back = button("← Quay lại nhập hàng");
        back.setOnClickListener(v -> finish());
        root.addView(back);
        root.addView(text("ỐC 11 • KIỂM KHO", 22, true));
        root.addView(text(
                "Số tồn tăng dần • Nhập thực tế • Lưu trên máy cho đến khi bấm Đồng bộ",
                13, false));

        String updated = store.getCacheUpdatedAt("inventory");
        TextView snapshot = text(
                "Dữ liệu tồn: " + (updated == null ? "Chưa đồng bộ" : updated), 13, false);
        snapshot.setPadding(0, dp(8), 0, dp(8));
        root.addView(snapshot);

        if (!hasRevisionData) {
            TextView error = text(
                    "Dữ liệu tồn chưa có phiên bản kiểm kho. Hãy về màn hình chính và Đồng bộ trước.",
                    14, true);
            error.setTextColor(Color.rgb(170, 35, 35));
            root.addView(error);
        }

        if (editingId > 0) {
            TextView hint = text(
                    "Đang sửa phiếu chưa đồng bộ. Giữ mốc tồn gốc để tránh ghi đè phát sinh mới.",
                    13, false);
            root.addView(hint);
            Button refreshBase = button("Lấy mốc tồn mới (khi có xung đột)");
            refreshBase.setOnClickListener(v -> new AlertDialog.Builder(this)
                    .setTitle("Làm mới mốc tồn?")
                    .setMessage(
                            "Chỉ chọn khi đã bấm Đồng bộ để tải tồn mới. " +
                            "Số thực tế đã nhập vẫn được giữ, " +
                            "nhưng phiên bản so sánh sẽ đổi theo máy tính.")
                    .setNegativeButton("Hủy", null)
                    .setPositiveButton("Dùng tồn mới", (dialog, which) -> {
                        useFreshReference = true;
                        renderRows();
                    })
                    .show());
            root.addView(refreshBase);
        } else if (store.pendingStocktakeCount() > 0) {
            TextView hint = text(
                    "Đang có phiếu kiểm kho chờ đồng bộ. Hãy đồng bộ hoặc sửa/xóa phiếu đó trước.",
                    13, true);
            hint.setTextColor(Color.rgb(180, 85, 0));
            root.addView(hint);
        }

        search = new EditText(this);
        search.setSingleLine(true);
        search.setHint("Tìm mặt hàng...");
        root.addView(search);

        filterButton = button("Đang theo dõi • Hiện cả hàng ngừng");
        filterButton.setOnClickListener(v -> {
            showAll = !showAll;
            filterButton.setText(
                    showAll ? "Tất cả • Chỉ hiện đang theo dõi"
                            : "Đang theo dõi • Hiện cả hàng ngừng");
            renderRows();
        });
        root.addView(filterButton);

        countStatus = text("", 13, false);
        countStatus.setPadding(0, dp(8), 0, dp(8));
        root.addView(countStatus);

        Button save = button(editingId > 0 ? "Lưu thay đổi phiếu kiểm" : "Lưu phiếu kiểm kho");
        save.setOnClickListener(v -> saveStocktake());
        save.setEnabled(hasRevisionData && !stock.isEmpty());
        root.addView(save);

        stockContainer = vertical();
        root.addView(stockContainer);

        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                renderRows();
            }
            @Override public void afterTextChanged(Editable s) {}
        });

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
        renderRows();
    }

    private void renderRows() {
        if (stockContainer == null) return;
        stockContainer.removeAllViews();
        String keyword = search == null ? "" :
                search.getText().toString().trim().toLowerCase(Locale.ROOT);
        int visible = 0;
        for (JSONObject row : stock) {
            int id = row.optInt("item_id");
            boolean tracked = row.optBoolean("is_stock_tracked", false);
            if (!showAll && !tracked) continue;
            if (!row.optString("item_name").toLowerCase(Locale.ROOT).contains(keyword)) {
                continue;
            }
            visible++;
            LinearLayout card = card();
            TextView title = text(row.optString("item_name"), 16, true);
            card.addView(title);

            String unit = row.optString("smallest_unit_name");
            double base = row.optDouble("stock_quantity", 0);
            JSONObject original = originalLine(id);
            if (original != null && !useFreshReference) {
                base = original.optDouble("expected_quantity", base);
            }
            String info = "Tồn hệ thống: " + NUMBER.format(base) + " " + unit;
            if (!tracked) info += " • Ngừng theo dõi";
            TextView detail = text(info, 13, false);
            detail.setPadding(0, dp(4), 0, dp(2));
            card.addView(detail);

            EditText actual = new EditText(this);
            actual.setSingleLine(true);
            actual.setHint("Số thực tế (" + unit + ") • Để trống nếu chưa kiểm");
            actual.setInputType(InputType.TYPE_CLASS_NUMBER |
                    InputType.TYPE_NUMBER_FLAG_DECIMAL |
                    InputType.TYPE_NUMBER_FLAG_SIGNED);
            actual.setEnabled(tracked);
            String previous = drafts.get(id);
            if (previous != null) actual.setText(previous);
            actual.addTextChangedListener(new TextWatcher() {
                @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                    String value = s.toString().trim();
                    if (value.isEmpty()) drafts.remove(id);
                    else drafts.put(id, value);
                    countStatus.setText("Đã nhập thực tế: " + drafts.size() + " mặt hàng");
                }
                @Override public void afterTextChanged(Editable s) {}
            });
            card.addView(actual);
            stockContainer.addView(card);
        }
        countStatus.setText(
                "Hiển thị: " + visible + " mặt hàng • Đã nhập: " + drafts.size());
        if (visible == 0) {
            stockContainer.addView(text(
                    stock.isEmpty() ? "Chưa có dữ liệu tồn. Bấm Đồng bộ ở màn hình chính."
                            : "Không có mặt hàng phù hợp.", 14, false));
        }
    }

    private JSONObject originalLine(int itemId) {
        if (editingPayload == null) return null;
        JSONArray lines = editingPayload.optJSONArray("items");
        if (lines == null) return null;
        for (int i = 0; i < lines.length(); i++) {
            JSONObject row = lines.optJSONObject(i);
            if (row != null && row.optInt("item_id") == itemId) return row;
        }
        return null;
    }

    private void saveStocktake() {
        if (!hasRevisionData || stock.isEmpty()) {
            Toast.makeText(this, "Hãy đồng bộ dữ liệu tồn mới trước.", Toast.LENGTH_LONG).show();
            return;
        }
        if (editingId < 0 && store.pendingStocktakeCount() > 0) {
            Toast.makeText(this, "Đã có phiếu kiểm chờ đồng bộ. Hãy xử lý phiếu cũ trước.",
                    Toast.LENGTH_LONG).show();
            return;
        }
        if (drafts.isEmpty()) {
            Toast.makeText(this, "Chưa nhập tồn thực tế của mặt hàng nào.",
                    Toast.LENGTH_LONG).show();
            return;
        }

        try {
            JSONArray lines = new JSONArray();
            for (JSONObject row : stock) {
                int id = row.optInt("item_id");
                String value = drafts.get(id);
                if (value == null) continue;
                if (!row.optBoolean("is_stock_tracked", false)) {
                    throw new Exception(
                            row.optString("item_name") + " đã ngừng theo dõi. Không thể kiểm kho.");
                }
                double quantity;
                try {
                    quantity = Double.parseDouble(value.replace(",", "."));
                } catch (NumberFormatException error) {
                    throw new Exception("Số thực tế không hợp lệ: " + row.optString("item_name"));
                }
                if (Double.isNaN(quantity) || Double.isInfinite(quantity) || quantity < 0) {
                    throw new Exception("Tồn thực tế phải là số không âm.");
                }

                JSONObject original = useFreshReference ? null : originalLine(id);
                JSONObject line = new JSONObject();
                line.put("item_id", id);
                line.put("actual_quantity", quantity);
                line.put("expected_quantity",
                        original == null
                                ? row.optDouble("stock_quantity", 0)
                                : original.optDouble("expected_quantity", 0));
                line.put("expected_revision",
                        original == null
                                ? row.optInt("stock_revision", -1)
                                : original.optInt("expected_revision", -1));
                if (line.optInt("expected_revision", -1) < 0) {
                    throw new Exception("Thiếu phiên bản tồn. Đồng bộ lại trước khi kiểm.");
                }
                lines.put(line);
            }
            if (lines.length() != drafts.size()) {
                throw new Exception("Có mặt hàng không còn trong danh sách. Cần đồng bộ lại.");
            }
            JSONObject payload = new JSONObject();
            payload.put("client_sync_id", UUID.randomUUID().toString());
            payload.put("reason", "Kiểm kho Android");
            payload.put("items", lines);

            if (editingId > 0) store.updateStocktake(editingId, payload);
            else store.saveStocktake(payload, new SimpleDateFormat(
                    "yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(new Date()));

            Toast.makeText(this, "Đã lưu phiếu kiểm offline. Bấm Đồng bộ để gửi lên máy tính.",
                    Toast.LENGTH_LONG).show();
            finish();
        } catch (Exception ex) {
            new AlertDialog.Builder(this)
                    .setTitle("Chưa lưu được phiếu kiểm")
                    .setMessage(ex.getMessage())
                    .setPositiveButton("Đóng", null)
                    .show();
        }
    }

    @Override
    protected void onDestroy() {
        if (store != null) store.close();
        super.onDestroy();
    }
}
