# OC11

Hệ thống quản lý nội bộ cho Quán Ốc 11.

## Kiến trúc giai đoạn 1

- **Manager Web:** React + TypeScript + Ant Design
- **Backend/API:** FastAPI
- **Database:** SQLite chạy local
- **POS:** tách riêng, sẽ triển khai sau
- **Backup:** bản sao SQLite lên Google Drive
- **Source & CI:** GitHub + GitHub Actions

Manager Web và POS không truy cập trực tiếp file SQLite. Cả hai dùng chung Backend/API.

## Quy trình phát triển

```
IDEA -> DATABASE -> UI -> IMPLEMENT -> TEST -> LOCK
```

Mỗi chức năng chỉ được mở rộng sau khi nghiệp vụ và dữ liệu cần thiết đã được chốt.

## Feature hiện tại

**Feature 01 - Nhóm hàng hóa**

- Thêm nhóm
- Sửa nhóm
- Active / Inactive
- Không có chức năng xóa
- Tên nhóm duy nhất theo nghiệp vụ, không phân biệt hoa/thường

Chi tiết: `docs/features/01-item-groups.md`

## Chạy Backend

Yêu cầu Python 3.12+.

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs:

```
http://localhost:8000/docs
```

## Chạy Manager Web

Yêu cầu Node.js 22+.

```bash
cd manager-web
npm install
npm run dev
```

Mở:

```
http://localhost:5173
```

Trong môi trường dev, Vite tự proxy `/api` sang FastAPI tại cổng 8000.

## Test

Backend:

```bash
pytest backend/tests
```

Frontend:

```bash
cd manager-web
npm install
npm run build
```

GitHub Actions tự chạy hai bước trên mỗi lần push hoặc tạo pull request.
