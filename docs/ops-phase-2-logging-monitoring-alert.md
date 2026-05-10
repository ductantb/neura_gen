# Ops Phase 2: Logging + Monitoring + Alert

Phase 2 tập trung vào 3 mục tiêu:

1. Chuẩn hóa log dạng JSON cho API và worker.
2. Có correlation id (`requestId` / `jobId`) để trace sự cố.
3. Có endpoint metrics cơ bản để theo dõi và đặt cảnh báo.

## 1) Những gì đã triển khai

## 1.1 Structured logger (JSON)

- File: `src/infra/logging/structured-logger.service.ts`
- Chức năng:
  - Log 1 dòng JSON/record.
  - Level hỗ trợ: `debug`, `info`, `warn`, `error`.
  - Điều khiển mức log bằng env `LOG_LEVEL` (mặc định `info`).

JSON mẫu:

```json
{
  "timestamp": "2026-05-05T10:00:00.000Z",
  "level": "info",
  "event": "api.request.completed",
  "requestId": "fcb3b9f0-c0f7-4f42-88cf-0cb9d8f8f861",
  "method": "POST",
  "path": "/jobs/video",
  "statusCode": 201,
  "durationMs": 152
}
```

## 1.2 API request logging middleware

- File: `src/infra/logging/request-logging.middleware.ts`
- Được đăng ký toàn cục trong `AppModule`.
- Hành vi:
  - Nhận `x-request-id` từ client nếu có, nếu không tự tạo UUID.
  - Trả lại `x-request-id` trên response header.
  - Log mỗi request khi `res.finish`.
  - Tự phân cấp level:
    - `2xx/3xx` -> `info`
    - `4xx` -> `warn`
    - `5xx` -> `error`

Các field log chính:

- `requestId`
- `method`
- `path`
- `statusCode`
- `durationMs`
- `ip`
- `userId` (nếu có auth)
- `userAgent`

## 1.3 Worker structured logs

- File: `src/workers/video.worker.ts`
- File: `src/workers/main.worker.ts`

Đã bổ sung event log quan trọng:

- `worker.bootstrap.started`
- `worker.bootstrap.disabled`
- `worker.bootstrap.failed`
- `worker.start.ready`
- `worker.start.skipped`
- `worker.job.received`
- `worker.job.status`
- `worker.job.log`
- `worker.job.retrying`
- `worker.job.completed`
- `worker.job.cancelled`
- `worker.job.failed`

Correlation phía worker:

- Luôn có `jobId` trong log event xử lý job.
- Dùng được cho truy vết chuỗi sự cố theo từng job.

## 1.4 Provider Modal logs chuẩn hóa

- File: `src/modules/modal/modal.service.ts`
- Bỏ `console.log` thô, thay bằng event có cấu trúc:
  - `provider.modal.request`
  - `provider.modal.response`
  - `provider.modal.error`

Lợi ích:

- Không spam full payload lớn vào stdout.
- Dễ lọc log theo `event` và `jobId`.

## 1.5 Metrics endpoint

- Module mới:
  - `src/modules/ops/ops.module.ts`
  - `src/modules/ops/ops.controller.ts`
  - `src/modules/ops/ops.service.ts`

- Endpoint: `GET /ops/metrics`
- Decorator:
  - `@Public()`
  - `@SkipThrottle()`

Response bao gồm:

1. `ok` tổng quan (DB + Redis)
2. `process`:
   - `pid`
   - `uptimeSeconds`
   - `nodeVersion`
   - `memory` (`rss`, `heapUsed`, `heapTotal`, `external`)
3. `dependencies`:
   - `database` (`ok`, `message`)
   - `redis` (`ok`, `message`)
4. `queue`:
   - `name`
   - `ok`
   - `counts` (`waiting`, `active`, `completed`, `failed`, `delayed`, `paused`)

## 1.6 Metrics token guard

Để tránh public lộ metrics khi production:

- Nếu đặt env `OPS_METRICS_TOKEN`, endpoint `/ops/metrics` bắt buộc header:
  - `x-ops-token: <OPS_METRICS_TOKEN>`
- Nếu không đặt env này, endpoint mở công khai (hữu ích cho dev/staging).

## 1.7 Health readiness tái sử dụng logic ops service

- `GET /health` hiện gọi chung `OpsService.assertReadyOrThrow()`.
- Trả `503` khi DB/Redis lỗi.

## 2) File thay đổi chính

- `src/app.module.ts`
- `src/app.controller.ts`
- `src/app.controller.spec.ts`
- `src/infra/logging/logging.module.ts`
- `src/infra/logging/structured-logger.service.ts`
- `src/infra/logging/request-logging.middleware.ts`
- `src/modules/ops/ops.module.ts`
- `src/modules/ops/ops.controller.ts`
- `src/modules/ops/ops.service.ts`
- `src/modules/ops/ops.service.spec.ts`
- `src/workers/main.worker.ts`
- `src/workers/video.worker.ts`
- `src/workers/video.worker.spec.ts`
- `src/modules/modal/modal.service.ts`
- `src/modules/modal/modal.service.spec.ts`

## 3) Biến môi trường mới/được dùng

## 3.1 Logging

- `LOG_LEVEL=debug|info|warn|error` (mặc định `info`)

## 3.2 Metrics security

- `OPS_METRICS_TOKEN=<secret-token>` (khuyến nghị bật ở production)

## 4) Hướng dẫn vận hành monitoring

## 4.1 Probe cơ bản

1. Readiness:
   - `GET /health`
2. System metrics:
   - `GET /ops/metrics`
   - Header `x-ops-token` nếu có bật token

Ví dụ:

```bash
curl -H "x-ops-token: $OPS_METRICS_TOKEN" https://api.your-domain.com/ops/metrics
```

## 4.2 Log query gợi ý

Tùy nền tảng log (Railway, ELK, Loki...), dùng `event` để lọc:

1. API lỗi 5xx:
   - `event="api.request.completed" AND statusCode>=500`
2. Job fail:
   - `event="worker.job.failed"`
3. Job retry tăng bất thường:
   - `event="worker.job.retrying"`
4. Provider modal lỗi:
   - `event="provider.modal.error"`

## 5) Alert rule khuyến nghị (baseline)

## 5.1 API availability

1. `health` trả `503` liên tục > 2 phút -> critical
2. Tỷ lệ request 5xx > 5% trong 5 phút -> high

## 5.2 Queue/worker health

1. `queue.counts.waiting` tăng liên tục 10 phút -> high
2. `worker.job.failed` tăng đột biến (> N/min) -> high
3. Không thấy `worker.job.completed` trong khung thời gian có traffic -> high

## 5.3 Provider reliability

1. `provider.modal.error` vượt ngưỡng nền trong 10 phút -> medium/high
2. `worker.job.retrying` tăng mạnh -> medium

## 5.4 Resource saturation

1. `process.memory.rssBytes` vượt ngưỡng instance (vd > 80% memory plan) -> high
2. `queue.active` chạm trần lâu + `waiting` tăng -> scale worker

## 6) Kiểm thử đã chạy

1. Unit tests:
   - `src/modules/ops/ops.service.spec.ts`
   - `src/app.controller.spec.ts`
   - `src/modules/modal/modal.service.spec.ts`
   - `src/workers/video.worker.spec.ts`
2. Lệnh test:
   - `npm run test -- ops.service.spec.ts app.controller.spec.ts modal.service.spec.ts video.worker.spec.ts --runInBand`
3. Build:
   - `npm run build`

## 7) Giới hạn hiện tại và bước nâng cấp Phase 2.5 (khuyến nghị)

1. Metrics hiện trả JSON app-level, chưa phải Prometheus text format.
2. Alert chưa tự gửi Slack/Email trong code, hiện dựa vào platform monitoring.
3. Chưa có distributed trace đầy đủ (OpenTelemetry).

Nâng cấp tiếp theo nên làm:

1. Export Prometheus metrics chuẩn (`/metrics`).
2. Đẩy log vào hệ thống tập trung (ELK/Loki/Datadog) thay vì chỉ stdout.
3. Thêm notifier tự động (Slack webhook) cho alert quan trọng.
