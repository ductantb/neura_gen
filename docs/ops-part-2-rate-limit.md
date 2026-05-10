# Ops Part 2: Rate Limit cho API nhạy cảm

## Mục tiêu

Giảm nguy cơ brute-force, spam request tốn tài nguyên, và abuse vào các endpoint quan trọng.

## Thay đổi đã triển khai

### 1) Bật throttler global

- Tích hợp `@nestjs/throttler`.
- Đăng ký `ThrottlerGuard` ở mức `APP_GUARD`.
- Thiết lập limit mặc định toàn hệ thống:
  - `THROTTLE_TTL_MS` (mặc định `60000`)
  - `THROTTLE_LIMIT` (mặc định `120`)

### 2) Áp limit riêng cho route nhạy cảm

- `POST /auth/register`: `5` req / `5` phút
- `POST /auth/login`: `10` req / `1` phút
- `POST /auth/google/token`: `30` req / `1` phút
- `POST /auth/google/exchange-code`: `30` req / `1` phút
- `POST /auth/refresh`: `30` req / `1` phút
- `POST /auth/forgot-password`: `3` req / `15` phút
- `POST /auth/reset-password`: `10` req / `15` phút
- `POST /jobs/video`: `20` req / `1` phút
- `POST /jobs/:id/cancel`: `20` req / `1` phút
- `GET /jobs/:id/events` (SSE): `30` req / `1` phút
- `GET /jobs/events/me` (SSE): `30` req / `1` phút
- `POST /assets/upload`: `30` req / `1` phút
- `POST /billing/orders`: `20` req / `1` phút

### 3) Skip throttle cho endpoint đặc thù

- `GET /health`
- `POST /billing/webhooks/momo`
- `POST /billing/webhooks/payos`

Lý do: tránh làm hỏng healthcheck và callback từ payment provider.

## File thay đổi

- `src/app.module.ts`
- `src/modules/auth/auth.controller.ts`
- `src/modules/jobs/jobs.controller.ts`
- `src/modules/assets/assets.controller.ts`
- `src/modules/billing/billing.controller.ts`
- `src/app.controller.ts`

## Gói phụ thuộc mới

- `@nestjs/throttler`

## Lưu ý vận hành

- Mức limit hiện tại là baseline an toàn để go-live sớm.
- Khi có traffic thật, nên tune lại bằng số liệu log thực tế (đặc biệt auth và jobs).
- Nếu scale nhiều instance `api`, cân nhắc chuyển storage throttler sang Redis để đồng bộ limit cross-instance.
