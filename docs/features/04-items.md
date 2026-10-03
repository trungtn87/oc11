# Feature 04 — Hàng hóa / Nguyên vật liệu

## Trạng thái
IMPLEMENTED — chờ Owner test thực tế trước khi LOCK.

## Phạm vi
Module này chỉ quản lý những thứ **thực sự được nhập và theo dõi trong kho**.
Món trong thực đơn là module riêng, không lưu chung bảng này.

## Loại hàng hóa
- `material` — Nguyên vật liệu, ví dụ: ốc hương, ngao, bơ, tỏi.
- `direct_sale` — Hàng bán trực tiếp, ví dụ: bia lon, nước ngọt chai.

## Trường dữ liệu
- Tên hàng hóa — bắt buộc, duy nhất không phân biệt hoa/thường.
- Loại — bắt buộc.
- Nhóm hàng hóa — bắt buộc, khóa ngoại tới `item_groups`.
- Đơn vị tính — bắt buộc, khóa ngoại tới `units`.
- Ghi chú — tùy chọn.
- Trạng thái — đang sử dụng / ngừng sử dụng.

## Quy tắc
- Không có chức năng xóa.
- Khi không còn dùng, chuyển sang trạng thái ngừng sử dụng.
- Nhóm hoặc đơn vị đã ngừng vẫn được giữ cho bản ghi cũ; UI không cho chọn mới các master đã ngừng.

## Cost và tồn kho
**Không lưu giá vốn và tồn hiện tại trực tiếp trên master Hàng hóa.**

Giá vốn sẽ được xác định từ dữ liệu nhập hàng theo phương pháp cost được chốt ở bước sau.
Tồn kho sẽ được tính từ các biến động kho.

Điều này giữ một nguồn dữ liệu duy nhất và tránh cost thủ công bị lệch so với giá nhập thực tế.

## API
- `GET /api/items`
- `POST /api/items`
- `PUT /api/items/{item_id}`
- Không triển khai DELETE.
