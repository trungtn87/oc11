# Feature 01 - Nhóm hàng hóa

## Trạng thái

| Bước | Trạng thái |
|---|---|
| IDEA | ✅ Chốt |
| DATABASE | ✅ Chốt |
| UI | ✅ Chốt |
| IMPLEMENT | 🟡 Đang triển khai |
| TEST | ⬜ |
| LOCK | ⬜ |

## 1. Nghiệp vụ đã chốt

Chức năng dùng để quản lý các nhóm hàng hóa/nguyên liệu của Ốc 11.

Có đúng ba thao tác nghiệp vụ:

1. Thêm nhóm.
2. Sửa nhóm.
3. Chuyển trạng thái Active / Inactive.

**Không có chức năng xóa.**

Tên nhóm là duy nhất theo nghiệp vụ và khi kiểm tra trùng **không phân biệt hoa/thường**.

## 2. Database

SQLite.

```sql
CREATE TABLE item_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    note TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1))
);
```

Không có:

- type
- created_at
- updated_at
- deleted_at
- name_key

Quy tắc không phân biệt hoa/thường được kiểm tra ở backend để giữ schema đơn giản.

## 3. UI

Màn hình danh sách:

- Tên nhóm
- Ghi chú
- Trạng thái
- Sửa
- Nút **+ Thêm nhóm**

Form Thêm/Sửa:

- Tên nhóm
- Ghi chú
- Trạng thái
- Hủy
- Lưu

Không hiển thị thao tác xóa.

## 4. API

- `GET /api/item-groups`
- `POST /api/item-groups`
- `PUT /api/item-groups/{id}`

Không có DELETE endpoint.

## 5. Test bắt buộc

- Thêm nhóm thành công.
- Danh sách trả đúng dữ liệu.
- Không cho tạo tên trùng nếu chỉ khác hoa/thường.
- Sửa tên/ghi chú thành công.
- Chuyển Active -> Inactive thành công.
- DELETE không được hỗ trợ.
- Frontend build thành công.

Sau khi test đạt và Owner duyệt thì chuyển trạng thái sang **LOCK**.
