# Kiểm kho offline — Ốc 11 (2026-10-08)

## Phạm vi

- Quản lý hàng hóa trên Web có cờ **Theo dõi tồn kho** độc lập với `is_active`.
- Trang tồn kho lọc Đang theo dõi / Ngừng theo dõi / Tất cả, mặc định Đang theo dõi và số tồn tăng dần.
- Web đối chiếu một hoặc nhiều hàng hóa trên một phiếu.
- Android có màn hình kiểm kho, tìm kiếm, nhập thực tế, xếp tồn tăng dần, lưu offline và chỉ gửi khi bấm **Đồng bộ**.

## Schema

- `items.is_stock_tracked INTEGER NOT NULL DEFAULT 1`. Khi ngừng theo dõi, **không xóa số tồn, không xóa chuyển động kho**; việc bán/nhập hàng tuân theo `is_active` cũ.
- `stock_adjustments.client_sync_id TEXT` (unique khi không null) và `client_payload_hash TEXT` cho stocktake batch.
- Nghiệp vụ batch sử dụng bảng `stock_adjustments`, `stock_adjustment_items` và `inventory_movements` đã có.
- Local Android DB tăng version từ 1 lên 2, tạo thêm bảng `stocktakes` mà không xóa dữ liệu `receipts`, `cache`.

## API

- `PATCH /api/items/{id}/stock-tracking` với body `{"is_stock_tracked": false}`.
- `GET /api/inventory/stock?tracking=TRACKED|UNTRACKED|ALL` (mặc định ALL để tương thích ứng dụng cũ). Mỗi dòng trả `stock_revision`, `stock_quantity`, `is_stock_tracked`, `is_active`.
- `POST /api/inventory/adjustments/batch`:

```json
{
  "client_sync_id": "uuid-do-android-sinh-va-luu",
  "reason": "Kiểm kho Android",
  "items": [
    {
      "item_id": 1,
      "expected_quantity": 5,
      "expected_revision": 123,
      "actual_quantity": 4.5
    }
  ]
}
```

- API thực hiện `BEGIN IMMEDIATE`, kiểm tra lại revision và số tồn của **tất cả** dòng. Nếu có thay đổi, trả `409 STOCK_CHANGED` và không ghi dòng nào; người dùng bấm đồng bộ để lấy số tồn mới, mở sửa phiếu và xác nhận **Lấy mốc tồn mới**.
- Replay `client_sync_id` + cùng payload trả chứng từ trước đó với `already_synced: true`, không cộng thêm tồn.
- Dùng lại `client_sync_id` với payload khác trả `409 SYNC_ID_REUSED`.
- Ghi nhận từng mặt hàng đã nhập số thực tế, cả mốc chênh lệch 0 (checkpoint), không ghi những dòng chưa kiểm.
- Tồn trên danh sách được lưu theo ĐVT nhỏ nhất.

## Quy trình test tại quán

1. Sao lưu `data/oc11.db` trước khi nâng cấp.
2. Nâng cấp Web/EXE, mở hàng hóa và xác nhận cờ theo dõi mặc định của hàng cũ, thử tắt rồi bật (không mất lịch sử).
3. Trên Web, kiểm 2 mặt hàng: một tăng, một giảm. Xác nhận tồn mới và dòng trong lịch sử.
4. Kiểm tra khả năng **cài đè APK** trước khi nâng cấp. Nếu Android báo chữ ký không khớp, **KHÔNG gỡ ứng dụng khi còn phiếu chưa đồng bộ**. Hãy đồng bộ hết phiếu cũ trước, sau đó mới cân nhắc gỡ/cài mới. Bản debug APK xây trên các runner GitHub khác nhau có thể mang chữ ký khác nhau; SQLite v1→v2 chỉ giữ dữ liệu khi ứng dụng được nâng cấp tại chỗ cùng chữ ký.
5. Bấm Đồng bộ lần đầu để tải danh sách có `stock_revision`.
6. Tắt mạng điện thoại, nhập tồn thực tế cho 2 mặt hàng, lưu phiếu offline; mở lại kiểm tra nội dung, sửa được và xóa được khi chưa đồng bộ.
7. Bật mạng cùng LAN, bấm Đồng bộ; kiểm trên Web chỉ xuất hiện một chứng từ và tồn đúng.
8. Kiểm xung đột: tải tồn trên điện thoại, sửa tồn trên Web / bán thêm, rồi đồng bộ phiếu kiểm cũ. Máy phải báo lỗi và **không ghi chênh lệch cũ**.
9. Bấm Đồng bộ để lấy snapshot mới, mở sửa phiếu lỗi, chọn **Lấy mốc tồn mới**, xác nhận thực tế rồi lưu và đồng bộ.
10. Thử ngắt mạng ngay sau khi server đã nhận phiếu: retry cùng ID phải trả về chứng từ đã có, không nhân đôi số tồn.

## Điều kiện phát hành APK cho thiết bị đang sử dụng

Để đảm bảo cập nhật APK lâu dài không làm mất dữ liệu offline, cần cấu hình **một khóa ký APK ổn định, lưu an toàn bằng GitHub Secrets hoặc quy trình ký phát hành riêng**. Không commit keystore/khóa bí mật vào repo. Các APK debug CI hiện tại chủ yếu dành cho máy test hoặc máy đã đồng bộ hết dữ liệu.

## Kiểm thử tự động

- `python -m pytest backend/tests`
- `cd manager-web && npm run build`
- `cd mobile-app && gradle :app:assembleDebug` (Java 17, Gradle 8.9, Android SDK 35).

**Chưa thay thế được test LAN/Android thực tế tại quán chỉ bằng CI.**
