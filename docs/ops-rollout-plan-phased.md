# Ops Rollout Plan (Phased)

Kế hoạch này ưu tiên "cơ bản trước", triển khai theo từng phần nhỏ, mỗi phần có tiêu chí xong rõ ràng.

## Phase 0 (Done)

- Part 1: readiness healthcheck DB + Redis.
- Part 2: rate-limit cho API nhạy cảm.

Tài liệu:
- `docs/ops-part-1-health-readiness.md`
- `docs/ops-part-2-rate-limit.md`

## Phase 1: Backup + Restore (Done)

### Việc cần làm

1. Bật backup tự động PostgreSQL (daily snapshot, retention 7-14 ngày).
2. Viết runbook restore chuẩn.
3. Diễn tập restore trên môi trường staging.
4. Bật S3 bucket versioning + lifecycle rule cho output artifacts.

### Kết quả đã làm trong repo

1. Tạo script backup: `scripts/backup-postgres.ps1`.
2. Tạo script restore: `scripts/restore-postgres.ps1`.
3. Tạo smoke test end-to-end: `scripts/smoke-test-backup-restore.ps1`.
4. Viết runbook: `docs/ops-phase-1-backup-restore.md`.

### Tiêu chí hoàn thành

1. Restore được DB ra môi trường mới và API chạy bình thường.
2. Có biên bản thời gian RTO/RPO thực tế.
3. Có tài liệu thao tác restore end-to-end.

## Phase 2: Logging + Monitoring + Alert (Done)

### Việc cần làm

1. Chuẩn hóa structured logs (JSON) cho API và worker.
2. Gắn request id/correlation id theo request/job.
3. Thiết lập alert cơ bản:
   - tỷ lệ `5xx`,
   - job fail rate,
   - queue backlog tăng bất thường,
   - worker down.

### Kết quả đã làm trong repo

1. Structured logger JSON cho API/worker (`src/infra/logging/*`).
2. Middleware request logging + `x-request-id` correlation.
3. Worker event logs theo `jobId` (`src/workers/video.worker.ts`).
4. Metrics endpoint `/ops/metrics` có DB/Redis/queue/process metrics.
5. Metrics token guard bằng `OPS_METRICS_TOKEN`.
6. Tài liệu chi tiết: `docs/ops-phase-2-logging-monitoring-alert.md`.

### Tiêu chí hoàn thành

1. Có dashboard xem được lỗi theo thời gian.
2. Có ít nhất 3 rule alert hoạt động.
3. Khi worker dừng, team nhận cảnh báo trong vài phút.

## Phase 3: Hardening runtime + deploy flow

### Việc cần làm

1. Tách rõ `staging` và `production` env.
2. Bổ sung CI gate tối thiểu: lint + unit test + build trước deploy.
3. Chuẩn hóa deploy flow: staging smoke test -> promote production.
4. Rà soát/rotate secrets quan trọng (JWT, DB, Redis, payment keys).

### Tiêu chí hoàn thành

1. Không deploy thẳng production từ local.
2. Có checklist pre-deploy và rollback rõ ràng.
3. Secrets không còn lộ trong docs/public logs.

## Phase 4: Performance baseline

### Việc cần làm

1. Đo baseline latency API chính (`auth`, `jobs`, `assets`).
2. Đo thời gian queue wait + processing cho `jobs/video`.
3. Tuning worker concurrency theo preset/provider.
4. Tối ưu query nóng (nếu thấy chậm qua log đo đạc).

### Tiêu chí hoàn thành

1. Có bảng số liệu baseline trước/sau.
2. P95 latency và fail rate cải thiện có định lượng.
3. Có ngưỡng autoscale hoặc hướng dẫn scale thủ công.

## Cách triển khai

Mỗi phase nên làm theo chu kỳ:

1. Chốt phạm vi nhỏ và rõ.
2. Triển khai code/config.
3. Kiểm thử thực tế.
4. Viết docs phần vừa xong.
5. Mới chuyển phase tiếp theo.
