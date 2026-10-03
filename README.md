# OC11

Hệ thống quản lý nội bộ cho Quán Ốc 11.

## Trạng thái hiện tại

- ✅ Khung **Ốc 11 Manager Web** với bố cục sidebar + topbar + dashboard.
- ✅ Trang **Tổng quan** đã có layout chuẩn; số liệu nghiệp vụ đang để 0/chưa có dữ liệu cho đến khi module tương ứng được xây thật.
- ✅ Feature 01 - **Nhóm hàng hóa**: Thêm / Sửa / Active-Inactive.
- ✅ FastAPI + SQLite local.
- ✅ GitHub Actions test backend và build frontend.
- ⏳ Các module Hàng hóa, Nhập hàng, Kho, Thu chi, POS, Báo cáo sẽ được làm lần lượt.

## Kiến trúc giai đoạn 1

- **Manager Web:** React + TypeScript + Ant Design
- **Backend/API:** FastAPI
- **Database:** SQLite chạy local
- **POS:** ứng dụng riêng, triển khai sau
- **Backup:** bản sao SQLite lên Google Drive
- **Source & CI:** GitHub + GitHub Actions

Manager Web và POS không truy cập trực tiếp SQLite. Cả hai dùng Backend/API chung.

## Quy trình phát triển

```
IDEA -> DATABASE -> UI -> IMPLEMENT -> TEST -> LOCK
```

## Chạy nhanh trên Windows

### Lần đầu

1. Cài **Python 3.12+** và nhớ chọn **Add Python to PATH**.
2. Cài **Node.js 22+**.
3. Tải repo OC11 về máy hoặc clone repo.
4. Chạy:

```
setup-windows.bat
```

### Những lần sau

Chỉ cần chạy:

```
start-oc11.bat
```

Hệ thống sẽ mở:

```
http://127.0.0.1:5173
```

Database local nằm tại:

```
backend/data/oc11.db
```

File database không được commit lên GitHub.

## Chạy thủ công

Backend:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Manager Web:

```bash
cd manager-web
npm install
npm run dev
```

## Test

Backend:

```bash
python -m pytest backend/tests
```

Frontend:

```bash
cd manager-web
npm run build
```

GitHub Actions tự chạy hai bước trên mỗi lần push hoặc pull request.

## Feature 01 - Nhóm hàng hóa

Chi tiết: `docs/features/01-item-groups.md`
