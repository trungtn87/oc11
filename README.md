# OC11

Hệ thống quản lý nội bộ cho Quán Ốc 11.

## Mục tiêu phát hành

Bản sử dụng thực tế trên Windows được phát hành dưới dạng:

```
OC11-Portable.zip
├── OC11.exe
├── HUONG-DAN.txt
└── data/
    └── oc11.db   # tự tạo khi chạy lần đầu
```

Người dùng chỉ cần **tải ZIP, giải nén một lần rồi chạy `OC11.exe`**. Máy sử dụng bản portable không cần cài Python hay Node.js.

Database luôn nằm ngoài EXE tại:

```
data/oc11.db
```

Vì vậy khi nâng cấp ứng dụng chỉ thay `OC11.exe`, giữ nguyên thư mục `data`.

## Trạng thái hiện tại

- ✅ Khung **Ốc 11 Manager Web** với sidebar + topbar + dashboard.
- ✅ Trang **Tổng quan** đã có layout chuẩn; số liệu nghiệp vụ đang để 0/chưa có dữ liệu cho đến khi module tương ứng được xây thật.
- ✅ Feature 01 - **Nhóm hàng hóa**: Thêm / Sửa / Active-Inactive.
- ✅ FastAPI + SQLite local.
- ✅ GitHub Actions test backend và build frontend.
- ✅ GitHub Actions build **Windows Portable ZIP**.
- ⏳ Các module Hàng hóa, Nhập hàng, Kho, Thu chi, POS, Báo cáo sẽ được làm lần lượt.

## Kiến trúc giai đoạn 1

- **Manager Web:** React + TypeScript + Ant Design
- **Backend/API:** FastAPI
- **Database:** SQLite chạy local
- **Windows Portable:** PyInstaller đóng gói backend + Manager Web vào `OC11.exe`
- **POS:** ứng dụng riêng, triển khai sau
- **Backup:** bản sao SQLite lên Google Drive
- **Source & CI:** GitHub + GitHub Actions

Manager Web và POS không truy cập trực tiếp SQLite. Cả hai dùng Backend/API chung.

## Quy trình phát triển

```
IDEA -> DATABASE -> UI -> IMPLEMENT -> TEST -> LOCK
```

## Tải bản Portable từ GitHub Actions

Workflow **Build Windows Portable** chạy tự động mỗi khi code được đẩy lên `main`.

Trong GitHub:

1. Mở tab **Actions**.
2. Chọn lần chạy **Build Windows Portable** mới nhất đã thành công.
3. Tải artifact **OC11-Portable** — GitHub sẽ tải về file `OC11-Portable.zip`.
4. Giải nén ZIP một lần vào thư mục muốn sử dụng.
5. Chạy `OC11.exe`.

## Dành cho phát triển

Nếu cần chạy source code trực tiếp:

### Windows lần đầu

Cài Python 3.12+ và Node.js 22+, sau đó chạy:

```
setup-windows.bat
```

Những lần sau:

```
start-oc11.bat
```

### Test

Backend:

```bash
python -m pytest backend/tests
```

Frontend:

```bash
cd manager-web
npm run build
```

GitHub Actions tự chạy test backend, build frontend và build bản Windows Portable.

## Feature 01 - Nhóm hàng hóa

Chi tiết: `docs/features/01-item-groups.md`
