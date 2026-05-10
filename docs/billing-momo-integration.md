# Billing Integration Guide (MoMo + payOS)

Tài liệu này mô tả chi tiết phần billing hiện tại của backend: luồng logic, API, kết nối service và cách tích hợp webhook thật cho MoMo và payOS.

## 1) Mục tiêu nghiệp vụ

- Bán gói `PRO` theo tháng.
- Nạp thêm `credit` bằng thanh toán online.
- Chỉ `PRO` dùng được preset premium (`quality_hunyuan_i2v`, `turbo_wan22_i2v_a14b`).
- `PRO` có quota free premium theo ngày, không cộng dồn.

## 2) Kiến trúc chạy trong docker-compose

File: `compose/docker-compose.yml`

Các service:

- `db` (PostgreSQL 15): lưu user, billing order, credit transactions.
- `redis` (Redis 7): queue cho job generation.
- `db_init`: chạy `prisma db push` + `prisma generate`.
- `api`: NestJS API xử lý auth/jobs/billing/webhook.
- `worker`: xử lý job video nền.

Kết nối logic:

1. Client gọi API billing trên `api`.
2. `api` ghi order vào `db`.
3. Nếu provider = `MOMO`, `api` gọi MoMo Create Payment API để lấy `payUrl`.
4. Nếu provider = `PAYOS`, `api` gọi payOS Create Payment Link API để lấy `checkoutUrl` (kèm QR).
5. Khách thanh toán tại MoMo hoặc payOS checkout.
6. Provider callback webhook vào endpoint public của `api`.
7. `api` verify signature + đối soát order, rồi cộng credit/nâng PRO trong DB.

## 3) Domain model chính

- `PaymentOrder`: đơn thanh toán (`PENDING/PAID/FAILED/...`), provider, package, amount, metadata.
- `CreditTransaction`: sổ cái credit (topup/pro purchase/spend/refund/free quota usage).
- `User.proExpiresAt`: thời điểm hết hạn PRO.
- `UserDailyUsage`: theo dõi free premium credits mỗi ngày.

## 4) Bảng giá hiện tại (catalog)

- Top-up:
  - `TOPUP_STARTER_4_99` -> 300 credits -> 125000 VND
  - `TOPUP_POPULAR_9_99` -> 700 credits -> 250000 VND
  - `TOPUP_PRO_14_99` -> 1000 credits -> 375000 VND
  - `TOPUP_MAX_19_99` -> 1500 credits -> 500000 VND
  - `TOPUP_STUDIO_49_99` -> 4200 credits -> 1250000 VND
- PRO:
  - `PRO_MONTHLY_14_99` -> 1000 credits + 30 ngày PRO -> 375000 VND

## 5) API billing hiện có

Base path: `/billing`

### 5.1 `GET /billing/catalog`

Lấy bảng giá + chính sách PRO/premium.

### 5.2 `POST /billing/orders`

Tạo đơn thanh toán.

Request body:

```json
{
  "type": "CREDIT_TOPUP",
  "provider": "MOMO",
  "packageCode": "TOPUP_POPULAR_9_99"
}
```

Hành vi:

- `BANK_TRANSFER`: tạo order `PENDING` và chờ đối soát.
- `MOMO`: tạo order `PENDING`, gọi MoMo `/v2/gateway/api/create`, trả `payUrl`.
- `PAYOS`: tạo order `PENDING`, gọi payOS `/v2/payment-requests`, trả `checkoutUrl`/`qrCode`.

Response mẫu (MOMO):

```json
{
  "id": "payment-order-id",
  "provider": "MOMO",
  "status": "PENDING",
  "amountUsd": "9.99",
  "amountVnd": 250000,
  "creditAmount": 700,
  "payUrl": "https://test-payment.momo.vn/...",
  "shortLink": "https://test-payment.momo.vn/shortlink/...",
  "note": "MoMo payment link created successfully."
}
```

### 5.3 `GET /billing/orders/me`

Lấy danh sách order của user hiện tại.

### 5.4 `POST /billing/orders/:id/mark-paid` (ADMIN)

API nội bộ/test để confirm paid thủ công (fallback khi chưa có webhook của provider khác).

### 5.5 `POST /billing/webhooks/momo` (public)

IPN webhook thật từ MoMo.

- Endpoint public, không cần JWT.
- Verify signature HMAC SHA256 theo chuẩn MoMo.
- Đối soát `partnerCode`, `orderId`, `amount`.
- Nếu `resultCode = 0` -> mark order paid, cộng credit/nâng PRO.
- Nếu `resultCode != 0` -> đánh dấu order failed (nếu còn pending).
- Trả HTTP `204 No Content`.

### 5.6 `POST /billing/webhooks/payos` (public)

Webhook callback thật từ payOS.

- Endpoint public, không cần JWT.
- Verify `signature` HMAC SHA256 theo `checksumKey`.
- Tìm order theo `metadata.payosOrderCode`.
- Đối soát `amount`.
- Thành công (`code = "00"`) -> mark order paid, cộng credit/nâng PRO.
- Thất bại -> chuyển order sang `FAILED` (nếu còn pending).
- Trả HTTP `204 No Content`.

### 5.7 `POST /billing/webhooks/payos/confirm` (ADMIN)

Đăng ký/confirm webhook URL với payOS từ backend.

Request body (optional):

```json
{
  "webhookUrl": "https://api.example.com/billing/webhooks/payos"
}
```

Nếu không truyền `webhookUrl`, backend sẽ dùng `PAYOS_WEBHOOK_URL` trong `.env`.

## 6) Luồng MoMo chi tiết

### 6.1 Tạo pay URL

1. Client gọi `POST /billing/orders` với `provider = MOMO`.
2. Server tạo `PaymentOrder` nội bộ.
3. Server tạo chữ ký request MoMo.
4. Server gọi `POST {MOMO_ENDPOINT}/v2/gateway/api/create`.
5. Nhận `payUrl/shortLink/...` và trả lại cho frontend.

### 6.2 Callback IPN

1. MoMo gửi POST JSON tới `MOMO_IPN_URL`.
2. Server parse payload.
3. Server tự build raw-signature và verify chữ ký.
4. Server kiểm tra:
   - order có tồn tại không
   - provider có đúng MOMO không
   - amount có khớp order không
5. Nếu thành công (`resultCode = 0`):
   - ghi trạng thái IPN vào metadata
   - gọi logic `markOrderPaid`
   - cộng credit, nâng PRO (nếu là gói PRO)
6. Trả `204`.

## 7) Biến môi trường cần có

Thêm vào `.env`:

```env
# MoMo (sandbox/prod)
MOMO_ENDPOINT=https://test-payment.momo.vn
MOMO_PARTNER_CODE=your_partner_code
MOMO_ACCESS_KEY=your_access_key
MOMO_SECRET_KEY=your_secret_key
MOMO_REDIRECT_URL=https://your-frontend.example.com/billing/momo-return
MOMO_IPN_URL=https://your-public-api.example.com/billing/webhooks/momo

# Optional
MOMO_REQUEST_TYPE=payWithMethod
MOMO_PARTNER_NAME=Neura Gen
MOMO_STORE_ID=NeuraGen
MOMO_LANG=vi
MOMO_AUTO_CAPTURE=true

# payOS
PAYOS_ENDPOINT=https://api-merchant.payos.vn
PAYOS_CLIENT_ID=your_payos_client_id
PAYOS_API_KEY=your_payos_api_key
PAYOS_CHECKSUM_KEY=your_payos_checksum_key
PAYOS_RETURN_URL=http://localhost:5173/billing/payos-return
PAYOS_CANCEL_URL=http://localhost:5173/billing/payos-return
# Optional
PAYOS_WEBHOOK_URL=https://your-public-api.example.com/billing/webhooks/payos
PAYOS_PARTNER_CODE=optional_partner_code
```

Lưu ý:

- Sandbox domain: `https://test-payment.momo.vn`
- Production domain: `https://payment.momo.vn`
- `MOMO_IPN_URL` bắt buộc phải là URL public MoMo truy cập được.
- Với payOS, khi chưa có domain FE có thể tạm dùng `localhost` cho `RETURN/CANCEL URL`.
- Webhook payOS có thể test bằng tunnel (`ngrok`) rồi cập nhật URL public sau.

## 8) Chạy local + test webhook

### 8.1 Khởi động stack

```bash
docker compose -f compose/docker-compose.yml up --build -d
```

### 8.2 Expose API local ra internet

Dùng tunnel (ngrok/cloudflared) để có URL public.

Ví dụ:

```bash
ngrok http 3000
```

Set `MOMO_IPN_URL` thành:

```text
https://<subdomain>.ngrok-free.app/billing/webhooks/momo
```

### 8.3 Test flow

1. Login lấy JWT.
2. Gọi `POST /billing/orders` với `provider=MOMO`.
3. Mở `payUrl` để thanh toán bằng tài khoản test MoMo.
4. Quan sát:
   - `PaymentOrder.status` chuyển `PAID`
   - `UserCredit.balance` tăng
   - nếu mua PRO thì `User.role=PRO`, `proExpiresAt` tăng.

## 9) Ghi chú bảo mật và vận hành

- Luôn verify chữ ký IPN trước khi cập nhật credit.
- Dùng `order.id` làm `requestId` để tận dụng idempotency của MoMo.
- Không dựa vào redirect URL để cộng credit, chỉ tin IPN server-to-server.
- Đảm bảo firewall whitelist/allowlist đúng môi trường nếu có.
- Không log lộ secret key.

## 10) Tham chiếu chính thức (đã dùng khi triển khai)

Ngày đối chiếu link gần nhất: `2026-04-18`.

### 10.1 MoMo (phần đang tích hợp trong backend)

- Collection Link + Create API (`POST /v2/gateway/api/create`)
  - https://developers.momo.vn/v3/docs/payment/api/collection-link/
- Payment Notification (IPN, server-to-server callback)
  - https://developers.momo.vn/v3/docs/payment/api/result-handling/notification/
- API Idempotency (xử lý retry an toàn)
  - https://developers.momo.vn/v3/docs/payment/api/result-handling/idempotency/
- Result Codes (mapping trạng thái giao dịch)
  - https://developers.momo.vn/v3/docs/payment/api/result-handling/resultcode/
- Integration process (onboarding, môi trường, domain)
  - https://developers.momo.vn/v3/docs/payment/onboarding/integration-process/

### 10.2 payOS (phần đang tích hợp chính hiện tại)

- Trang docs chính
  - https://payos.vn/docs/
- payOS API (Tạo link thanh toán, tra cứu, huỷ link, confirm webhook URL)
  - https://payos.vn/docs/api/
- Webhook payload trả về
  - https://payos.vn/docs/du-lieu-tra-ve/webhook/
- Kiểm tra chữ ký webhook (`signature`, `HMAC_SHA256`)
  - https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/

### 10.3 VietQR / NAPAS (tham chiếu nghiên cứu hướng VietQR)

- NAPAS FastFund 247 with VietQR code Service (nền tảng VietQR theo NAPAS)
  - https://en.napas.com.vn/napas-fastfund-247-with-vietqr-code-service
- Trang chính NAPAS (dịch vụ QR Code Payment)
  - https://en.napas.com.vn/
- VietQR.io docs/API (hệ sinh thái developer, khác với tài liệu trực tiếp từ NAPAS)
  - https://vietqr.io/
  - https://www.vietqr.io/danh-sach-api/link-tao-ma-nhanh/api-tao-ma-qr/

### 10.4 VNPAY (tham chiếu để so sánh phương án)

- Giới thiệu tích hợp sandbox
  - https://sandbox.vnpayment.vn/apis/docs/gioi-thieu/
- Luồng thanh toán PAY (Return URL + IPN URL)
  - https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
- Bộ tài liệu kỹ thuật / downloads
  - https://sandbox.vnpayment.vn/apis/downloads/

## 11) URL cần cập nhật khi deploy

Với luồng payOS hiện tại, bạn cần cập nhật tối thiểu:

- `PAYOS_RETURN_URL`: URL frontend nhận kết quả sau khi thanh toán.
- `PAYOS_CANCEL_URL`: URL frontend khi người dùng huỷ (có thể trùng `PAYOS_RETURN_URL`).
- `PAYOS_WEBHOOK_URL`: URL backend public nhận callback server-to-server từ payOS.

Sau khi có domain backend public, gọi API admin sau để confirm webhook với payOS:

- `POST /billing/webhooks/payos/confirm`
