# Feature 04 — Hàng hóa và Quy đổi đơn vị

## Trạng thái
IMPLEMENTED — chờ Owner test thực tế trước khi LOCK.

## Phạm vi
Hàng hóa chỉ lưu master data cơ bản. Thực đơn được quản lý riêng.

Không lưu trong master Hàng hóa:
- Giá nhập.
- Giá bán.
- Giá vốn.
- Số lượng tồn.

Các dữ liệu trên thuộc các bảng nghiệp vụ riêng.

## Bảng 1 — items
- `id`
- `name` — bắt buộc, không trùng không phân biệt hoa/thường.
- `item_group_id` — Nhóm hàng hóa.
- `default_unit_id` — đơn vị mặc định khi nhập hàng/các nghiệp vụ.
- `smallest_unit_id` — đơn vị nhỏ nhất dùng để hiển thị số lượng và làm chuẩn quy đổi.
- `note`
- `is_active`

Không có trường Loại hàng. Việc hàng hóa là nguyên liệu hay bán trực tiếp được quyết định bởi cách nó được dùng ở Thực đơn/Công thức/POS.

## Bảng 2 — item_unit_conversions
- `id`
- `item_id`
- `unit_id`
- `quantity_in_smallest_unit`
- `is_active`
- Unique: `(item_id, unit_id)`

Mỗi quy đổi có dạng:
`1 đơn vị = N đơn vị nhỏ nhất`.

Ví dụ Bia Tiger:
- Đơn vị mặc định: thùng.
- Đơn vị nhỏ nhất: lon.
- 1 thùng = 24 lon.
- 1 lốc = 6 lon.
- 1 lon = 1 lon.

Ví dụ Ốc hương:
- Đơn vị mặc định: kg.
- Đơn vị nhỏ nhất: g.
- 1 kg = 1000 g.
- 1 g = 1 g.

## Quy tắc
- Đơn vị nhỏ nhất luôn có hệ số = 1 và đang sử dụng.
- Nếu đơn vị mặc định khác đơn vị nhỏ nhất thì bắt buộc phải có quy đổi cho đơn vị mặc định.
- Một đơn vị chỉ được khai báo một lần trong cùng hàng hóa.
- Hệ số quy đổi phải > 0.
- Quy đổi là theo từng hàng hóa, không dùng quy đổi đóng gói toàn hệ thống.
- Hàng hóa không xóa; chỉ chuyển Ngừng sử dụng.
- Giá/tồn/cost không nằm trong hai bảng master này.
- Khi nhập hàng sau này, UI mặc định dùng `default_unit_id`, nhưng cho phép đổi sang các đơn vị quy đổi.
- Tồn kho/cost/định lượng sẽ quy về `smallest_unit_id`.

## Migration
Database cũ từ bản nháp có `item_type` + `unit_id` được tự động chuyển:
- bỏ logic Loại hàng.
- `unit_id` cũ trở thành cả default và smallest.
- tự tạo quy đổi hệ số 1 để giữ dữ liệu cũ.

## API
- `GET /api/items`
- `POST /api/items`
- `PUT /api/items/{item_id}`
- Không triển khai DELETE.
