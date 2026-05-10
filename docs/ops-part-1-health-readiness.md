# Ops Part 1: Health Readiness (DB + Redis)

## Mục tiêu

Nâng endpoint `GET /health` từ kiểu "alive" đơn giản sang "readiness" để phản ánh đúng khả năng phục vụ request của hệ thống.

## Thay đổi đã triển khai

- Endpoint `GET /health` vẫn public.
- Check kết nối PostgreSQL bằng `SELECT 1` qua Prisma.
- Check kết nối Redis bằng lệnh `PING`.
- Trả `200` khi cả hai thành phần đều healthy.
- Trả `503 Service Unavailable` khi ít nhất một thành phần lỗi.
- Thêm `@SkipThrottle()` cho `/health` để tránh bị rate-limit bởi hệ thống monitoring.

## Response format

Khi healthy (`200`):

```json
{
  "ok": true,
  "timestamp": "2026-05-05T10:00:00.000Z",
  "checks": {
    "database": true,
    "redis": true
  }
}
```

Khi unhealthy (`503`): cùng payload nhưng `ok=false` và một hoặc nhiều check là `false`.

## File thay đổi

- `src/app.controller.ts`
- `src/app.controller.spec.ts`

## Test đã chạy

- `npm run test -- app.controller.spec.ts --runInBand`
- `npm run build`

## Lưu ý vận hành

- Railway/Load Balancer nên dùng chính endpoint `/health` làm readiness.
- Nếu `db` hoặc `redis` lỗi thật, service sẽ tự bị loại khỏi traffic nhờ status `503`.
