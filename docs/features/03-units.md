# Feature 03 — Đơn vị tính

## Trạng thái
IMPLEMENTED — chờ Owner test thực tế trước khi LOCK.

## Nghiệp vụ
- Đơn vị tính dùng cho hàng hóa/nguyên vật liệu.
- Trường dữ liệu:
  - Tên đơn vị — bắt buộc.
  - Trạng thái — đang sử dụng / ngừng sử dụng.
- Tên đơn vị phải duy nhất, không phân biệt chữ hoa/chữ thường.
- Cho phép thêm mới và sửa.
- Không có chức năng xóa.
- Khi đơn vị không còn dùng, chuyển sang trạng thái ngừng sử dụng.

## Ví dụ
kg, con, chai, lon, túi, hộp, đĩa.

## API
- `GET /api/units`
- `POST /api/units`
- `PUT /api/units/{unit_id}`
- Không triển khai DELETE.

## Backup
Sau mỗi lần thêm hoặc sửa thành công, cơ chế backup SQLite hiện tại được gọi tự động.
