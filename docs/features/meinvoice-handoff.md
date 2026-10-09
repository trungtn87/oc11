# MISA meInvoice – kế hoạch chuyển giao an toàn cho Ốc 11 (09/10/2026)

## Hiện trạng và ranh giới phát hành

- **CUKCUK tiếp tục phát hành HĐĐT thật** bằng MISA meInvoice. Nhánh này KHÔNG chuyển nguồn phát hành, KHÔNG đăng nhập MISA, KHÔNG gọi API phát hành.
- POS Ốc 11 đã có luồng `request_einvoice=true` khi thanh toán và tạo `electronic_invoices.status=DRAFT`. Module này bổ sung màn hình **Bán hàng > Hóa đơn điện tử** để thấy yêu cầu và xem dữ liệu dự kiến; **Cài đặt > Kết nối MISA meInvoice** chỉ lưu MST người bán, ký hiệu, môi trường.
- Dữ liệu cấu hình **không** chứa token, mật khẩu, AppID bí mật; tuyệt đối không gửi thông tin xác thực qua API nội bộ chưa được bảo vệ.
- Phát hành thủ công/đối chiếu HĐĐT hiện vẫn thực hiện qua CUKCUK. `DRAFT` trên POS **không có nghĩa đã phát hành**.

## API nội bộ mới (không có endpoint phát hành)

| Endpoint | Chức năng |
|---|---|
| `GET /api/einvoice/settings` | Đọc metadata và khóa nguồn phát hành ở CUKCUK |
| `PUT /api/einvoice/settings` | Lưu `environment`, `company_tax_code`, `invoice_series`; từ chối thuộc tính khác |
| `GET /api/einvoice/orders` | Các đơn đã chốt, trạng thái yêu cầu HĐĐT trong SQLite |
| `GET /api/einvoice/orders/{id}/preview` | Xem khách, món, phụ thu, tổng tiền; danh sách điều kiện còn thiếu |
| `POST /api/einvoice/orders/{id}/request` | Lập đúng một bản nháp HĐĐT cho đơn đã chốt, đã chọn khách |

Nguồn phát hành `CUKCUK`, `live_enabled=false` và `sandbox_publish_enabled=false` là giá trị bất biến phía server, ngay cả khi người dùng đặt môi trường là `PRODUCTION`.

## Tài liệu MISA liên quan

- Cổng API chính: https://developer.misa.vn/products-openapi/MEINVOICE
- Hóa đơn khởi tạo từ máy tính tiền: https://doc.meinvoice.vn/api/Document/InvoicePublishCalculatingMachine.html
- API MISA tính tiền có nội dung `OrgInvoiceData`, `OriginalInvoiceDetail`, `TaxRateInfo`, và `RefID`. Chưa thể sinh bộ dữ liệu pháp lý chuẩn khi thực đơn chưa có quy tắc thuế theo từng món/phụ thu.

## Checklist trước khi triển khai phát hành trực tiếp (phải nghiệm thu riêng)

- [ ] MISA xác nhận API/tenant, mô hình HĐĐT của Ốc 11 (máy tính tiền hay hóa đơn thường), tài khoản sandbox và phương thức xác thực.
- [ ] Kiểm tra mẫu số, ký hiệu, MST người bán, thuế suất *từng mặt hàng/phụ thu*, tiền trước/sau thuế và làm tròn VND.
- [ ] Xây dựng adapter server-side với khóa bí mật được bảo vệ và quyền riêng; không lộ token cho trình duyệt/POS/LAN.
- [ ] Sinh `RefID` ổn định, ghi trạng thái **trước khi gửi**; timeout/mất phản hồi -> `UNKNOWN` và phải tra cứu nhà cung cấp, không gửi lại mù.
- [ ] Kiểm tra chống tạo trùng và xử lý đồng thời; theo dõi mã tra cứu, số hóa đơn, mã CQT, lỗi phát hành.
- [ ] Đối chiếu toàn bộ hóa đơn đã phát hành qua CUKCUK với đơn bán POS; tránh phát hành một đơn hai lần qua hai nguồn.
- [ ] Test mock + sandbox, test Windows portable và nghiệm thu đầu cuối trên dữ liệu giả lập, không dùng hóa đơn thật.
- [ ] Chủ quán xác nhận thời điểm cắt chuyển; bật cơ chế phát hành OC11 theo một thay đổi/PR riêng, có phương án rollback không phát hành trùng.

## Kiểm thử nhánh này

```bash
python -m pytest backend/tests/test_einvoice.py
python -m pytest backend/tests
cd manager-web && npm ci && npm run build
```

**Chưa nghiệm thu phát hành thật; không merge để thay thế CUKCUK.**
