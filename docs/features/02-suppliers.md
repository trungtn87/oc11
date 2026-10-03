# Feature 02 — Nhà cung cấp

## Trạng thái
IMPLEMENTED — chờ Owner test thực tế trước khi LOCK.

## Nghiệp vụ đã chốt
- Danh sách Nhà cung cấp chỉ hiển thị **Tên nhà cung cấp**.
- Bấm vào tên để mở form chi tiết.
- Dùng chung một form cho **Thêm mới / Xem / Sửa**.
- Các trường:
  - Tên nhà cung cấp — bắt buộc.
  - Số điện thoại — tùy chọn.
  - Địa chỉ — tùy chọn.
  - Ghi chú — tùy chọn.
  - Ngân hàng — tùy chọn.
  - Số tài khoản — tùy chọn.
  - Tên chủ tài khoản — tùy chọn.
  - QR thanh toán — tùy chọn, chọn ảnh từ thiết bị.
- Khi lưu chỉ kiểm tra Tên nhà cung cấp không trống.
- Được xóa khi chưa có dữ liệu nghiệp vụ liên kết.
- Khi đã có dữ liệu liên kết bằng `supplier_id`, không cho xóa.

## Lưu trữ QR
Ảnh QR được đọc từ thiết bị và lưu cùng bản ghi trong SQLite ở dạng data URL.
Nhờ vậy backup database hiện tại bao gồm cả QR, không cần quản lý thư mục ảnh rời.

## API
- `GET /api/suppliers`
- `POST /api/suppliers`
- `PUT /api/suppliers/{supplier_id}`
- `DELETE /api/suppliers/{supplier_id}`

## TEST cần Owner xác nhận
1. Thêm NCC chỉ có tên.
2. Thêm đủ thông tin và ảnh QR.
3. Bấm tên từ danh sách để xem chi tiết.
4. Chuyển từ Xem sang Sửa, lưu lại.
5. Xóa NCC chưa có liên kết.
6. Sau khi module Phiếu nhập dùng `supplier_id`, xác nhận NCC đã dùng không thể xóa.
