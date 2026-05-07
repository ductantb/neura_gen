# Neura Gen Backend

Backend NestJS cho hệ thống tạo video từ ảnh đầu vào, quản lý job xử lý AI và các tính năng social như gallery, post, comment, follow.

## Dự án này làm gì

- Xác thực người dùng bằng JWT access token + refresh token
- Upload asset đầu vào lên S3
- Tạo job `image-to-video`, đẩy vào hàng đợi BullMQ
- Worker xử lý job, gọi Modal để generate video
- Lưu video đầu ra và thumbnail lên S3
- Theo dõi tiến độ job theo thời gian thực qua SSE
- Quản lý gallery, bài đăng, bình luận, lượt thích và credit người dùng

## Công nghệ chính

- NestJS 11
- Prisma + PostgreSQL
- Redis + BullMQ
- AWS S3
- Modal cho inference video
- Swagger tại `/api`

## Kiến trúc chạy

```text
Client -> NestJS API -> PostgreSQL
                  -> Redis/BullMQ -> Worker -> Modal -> S3
```

API và worker là 2 tiến trình riêng. API nhận request và tạo job, worker lấy job từ Redis để xử lý nền.

## Vast Provider Quick Start

Repo da duoc chuan bi san runtime cho Vast (provider `standard`):

- `modal_app/video/vast_server.py`
- `modal_app/video/requirements-vast.txt`
- `modal_app/video/Dockerfile.vast`
- `docs/vastai-setup-checklist.md`

Lam theo checklist:

1. Build + push image Vast
2. Tao endpoint/workergroup tren Vast
3. Lay URL `/invoke` va `/health`
4. Dien vao `.env` (`VAST_GENERATE_VIDEO_URL`, `VAST_HEALTHCHECK_URL`)
5. Bat `VAST_ENABLED=true` va smoke test

## Yêu cầu cài đặt

Để chạy được đầy đủ end-to-end, bạn cần:

- Node.js `20+`
- npm `10+`
- Docker Desktop
- PostgreSQL 15 và Redis 7 nếu không dùng Docker
- 1 bucket AWS S3 cùng access key/secret key
- Endpoint Modal để generate video

Lưu ý:

- Repo hiện tại chưa có MinIO/local storage trong `docker-compose`, nên để chạy hoàn chỉnh bạn cần S3 thật hoặc môi trường S3-compatible đã cấu hình sẵn.
- Nếu chưa có endpoint Modal thì API vẫn khởi động được, nhưng job generate video sẽ lỗi khi worker gọi provider.

## Cài dependencies

```bash
npm install
```

## Cấu hình `.env`

Tạo file `.env` ở thư mục gốc project.

Mẫu an toàn để điền:

```env
DATABASE_URL="postgresql://neuragen_user:your_password@localhost:5432/neura_gen?schema=public"
# Nếu chạy bằng docker compose, đổi host localhost -> db

JWT_ACCESS_SECRET=replace_with_a_long_random_string
JWT_ACCESS_EXPIRES_IN=15m

JWT_REFRESH_SECRET=replace_with_another_long_random_string
JWT_REFRESH_EXPIRES_IN=7d

PORT=3000
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=120
LOG_LEVEL=info
# Optional: protect /ops/metrics in production
OPS_METRICS_TOKEN=replace_with_strong_random_secret

# Modal endpoints
MODAL_GENERATE_VIDEO_URL=https://your-ltx-endpoint.modal.run
MODAL_GENERATE_VIDEO_TURBO_WAN_URL=https://your-turbo-wan-endpoint.modal.run
MODAL_GENERATE_VIDEO_WAN_URL=https://your-wan-endpoint.modal.run
# Chỉ cần nếu dùng preset quality_hunyuan_i2v
MODAL_GENERATE_VIDEO_HUNYUAN_URL=https://your-hunyuan-endpoint.modal.run

# Redis
REDIS_HOST=localhost
# Nếu chạy bằng docker compose, đổi host localhost -> redis
REDIS_PORT=6379
VIDEO_QUEUE_NAME=video-gen

# App API thường để false; worker sẽ override thành true
RUN_WORKER=false
VIDEO_WORKER_CONCURRENCY=1

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_S3_BUCKET=your_bucket_name

STORAGE_DRIVER=s3
S3_KEY_PREFIX=neuragen

# Gmail SMTP (App Password)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_ENABLED=true
MAIL_USER=your_gmail_address
MAIL_APP_PASSWORD=your_gmail_app_password
MAIL_FROM="Neura Gen <your_gmail_address>"
FRONTEND_URL=http://localhost:5173
PASSWORD_RESET_TOKEN_TTL_MINUTES=15

# Google OAuth2 (quick login)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
GOOGLE_ALLOWED_AUDIENCES=web_client_id,android_client_id
OAUTH_STATE_SECRET=replace_with_strong_random_secret
OAUTH_STATE_EXPIRES_IN=10m
GOOGLE_AUTH_CODE_TTL_SECONDS=120
OAUTH_ALLOWED_REDIRECT_URIS=http://localhost:5173/auth/callback,neuragen://auth/callback

# MoMo Payment Gateway
MOMO_ENDPOINT=https://test-payment.momo.vn
MOMO_PARTNER_CODE=your_momo_partner_code
MOMO_ACCESS_KEY=your_momo_access_key
MOMO_SECRET_KEY=your_momo_secret_key
MOMO_REDIRECT_URL=http://localhost:5173/billing/momo-return
MOMO_IPN_URL=https://your-public-api.example.com/billing/webhooks/momo
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

### Ý nghĩa nhanh của các biến quan trọng

- `DATABASE_URL`: chuỗi kết nối PostgreSQL
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: secret để ký token
- `MODAL_GENERATE_VIDEO_URL`: endpoint preset `preview_ltx_i2v`
- `MODAL_GENERATE_VIDEO_TURBO_WAN_URL`: endpoint preset `turbo_wan22_i2v_a14b`
- `MODAL_GENERATE_VIDEO_WAN_URL`: endpoint preset `standard_wan22_ti2v`
- `MODAL_GENERATE_VIDEO_HUNYUAN_URL`: endpoint preset `quality_hunyuan_i2v`
- `REDIS_HOST`, `REDIS_PORT`: Redis cho BullMQ
- `RUN_WORKER`: bật/tắt worker trong tiến trình hiện tại
- `THROTTLE_TTL_MS`: cửa sổ thời gian rate-limit mặc định (milliseconds)
- `THROTTLE_LIMIT`: số request tối đa trong mỗi cửa sổ rate-limit mặc định
- `LOG_LEVEL`: mức log JSON (`debug|info|warn|error`)
- `OPS_METRICS_TOKEN`: token bảo vệ endpoint `GET /ops/metrics` (đọc từ header `x-ops-token`)
- `AWS_*`, `AWS_S3_BUCKET`: cấu hình lưu file lên S3
- `MAIL_*`: cấu hình Gmail SMTP để gửi email auth
- `MAIL_ENABLED=false`: tắt hẳn luồng gửi mail ở local/dev nếu chưa có SMTP hợp lệ
- `FRONTEND_URL`: URL frontend dùng để tạo reset link
- `PASSWORD_RESET_TOKEN_TTL_MINUTES`: thời gian hết hạn token reset password
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`: cấu hình đăng nhập nhanh bằng Google OAuth2
- `GOOGLE_ALLOWED_AUDIENCES`: danh sách client IDs được phép dùng để verify Google idToken
- `OAUTH_STATE_SECRET`, `OAUTH_STATE_EXPIRES_IN`: cấu hình state token cho OAuth redirect flow
- `GOOGLE_AUTH_CODE_TTL_SECONDS`: TTL auth code one-time ở callback
- `OAUTH_ALLOWED_REDIRECT_URIS`: redirect allowlist cho web/app callback
- `MOMO_*`: cấu hình tạo link thanh toán và nhận IPN webhook từ MoMo
- `PAYOS_*`: cấu hình tạo payment link và verify webhook chữ ký từ payOS

Lưu ý:

- Preset mặc định của hệ thống là `standard_wan22_ti2v`.
- Preset `turbo_wan22_i2v_a14b` là preset turbo riêng, không được chọn mặc định.
- Nếu bạn không deploy route Hunyuan thì không nên gọi preset `quality_hunyuan_i2v`.

## Cách chạy nhanh bằng Docker Compose

Đây là cách dễ nhất để chạy local vì project đã có sẵn `compose/docker-compose.yml`.

### 1. Chuẩn bị `.env`

- Dùng file `.env` như mẫu ở trên
- Đổi `DATABASE_URL` sang host `db`
- Đổi `REDIS_HOST` sang `redis`

Ví dụ:

```env
DATABASE_URL="postgresql://neuragen_user:your_password@db:5432/neura_gen?schema=public"
REDIS_HOST=redis
```

### 2. Khởi động services

```bash
docker compose -f compose/docker-compose.yml up --build -d
```

Compose sẽ tạo 4 service:

- `db`: PostgreSQL
- `redis`: Redis
- `api`: NestJS API tại cổng `3000`
- `worker`: tiến trình xử lý job nền

### 3. Chạy migration

```bash
docker compose -f compose/docker-compose.yml exec api npx prisma migrate deploy
```

### 4. Seed dữ liệu mẫu nếu cần

```bash
docker compose -f compose/docker-compose.yml exec api npx prisma db seed
```

Sau khi seed, có thể dùng tài khoản mẫu:

- Email: `test@gmail.com`
- Password: `12345678`

### 5. Truy cập hệ thống

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/api`
- Health readiness: `http://localhost:3000/health`
- Ops metrics: `http://localhost:3000/ops/metrics`

Xem log:

```bash
docker compose -f compose/docker-compose.yml logs -f api
docker compose -f compose/docker-compose.yml logs -f worker
```

Dừng hệ thống:

```bash
docker compose -f compose/docker-compose.yml down
```

## Cách chạy local không dùng Docker

Nếu bạn muốn chạy API/worker trực tiếp trên máy:

### 1. Tự chạy PostgreSQL và Redis

- PostgreSQL lắng nghe ở `localhost:5432`
- Redis lắng nghe ở `localhost:6379`

### 2. Điền `.env`

Giữ:

```env
DATABASE_URL="postgresql://neuragen_user:your_password@localhost:5432/neura_gen?schema=public"
REDIS_HOST=localhost
REDIS_PORT=6379
RUN_WORKER=false
```

### 3. Generate Prisma client và migrate database

```bash
npx prisma generate
npx prisma migrate deploy
```

Nếu muốn dữ liệu mẫu:

```bash
npx prisma db seed
```

### 4. Mở 2 terminal riêng

Terminal 1 chạy API:

```bash
npm run start:dev
```

Terminal 2 chạy worker.

PowerShell:

```powershell
$env:RUN_WORKER='true'
npm run worker:dev
```

Nếu dùng bash:

```bash
RUN_WORKER=true npm run worker:dev
```

### 5. Truy cập

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/api`

## Cách deploy Modal

Repo đã có hai entrypoint inference:

- [modal_app/video/app.py](modal_app/video/app.py) cho `preview_ltx_i2v`, `standard_wan22_ti2v` và `quality_hunyuan_i2v`
- [modal_app/video/turbo_wan_app.py](modal_app/video/turbo_wan_app.py) cho `turbo_wan22_i2v_a14b`

Nếu bạn chưa có endpoint Modal:

```bash
pip install modal
modal token new
modal deploy modal_app/video/app.py
modal deploy modal_app/video/turbo_wan_app.py
```

Hoặc dùng script có sẵn:

```bash
./scripts/deploy-modal.sh deploy main
./scripts/deploy-modal.sh deploy turbo
```

Sau khi deploy turbo app, nên prefetch checkpoint vào Modal Volume trước khi test thật:

```bash
modal run modal_app/video/turbo_wan_app.py::prefetch_runtime_assets
```

Sau khi deploy, lấy các URL endpoint Modal và điền vào:

- `MODAL_GENERATE_VIDEO_URL`
- `MODAL_GENERATE_VIDEO_TURBO_WAN_URL`
- `MODAL_GENERATE_VIDEO_WAN_URL`
- `MODAL_GENERATE_VIDEO_HUNYUAN_URL` nếu có route tương ứng

Lưu ý:

- File `modal_app/video/app.py` hiện có route cho LTX preview, Wan 2.2 standard và Hunyuan quality.
- File `modal_app/video/turbo_wan_app.py` là route riêng cho TurboDiffusion Wan 2.2 I2V A14B.
- Turbo app hỗ trợ các env tùy chọn:
  - `TURBO_WAN_ATTENTION_TYPE=original|sla|sagesla`
  - `TURBO_WAN_USE_QUANTIZED_CHECKPOINTS=true|false`
  - `TURBO_WAN_USE_ODE=true|false`
  - `TURBO_WAN_SLA_TOPK`, `TURBO_WAN_BOUNDARY`, `TURBO_WAN_SIGMA_MAX`
- Biến `MODAL_GENERATE_VIDEO_HUNYUAN_URL` chỉ cần khi bạn có endpoint Hunyuan riêng.

## Luồng sử dụng cơ bản

### 1. Đăng ký hoặc đăng nhập

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `GET /auth/google` (OAuth2 Google login)
- `POST /auth/google/token` (đăng nhập bằng Google idToken cho Android/Web SDK)
- `POST /auth/google/exchange-code` (đổi auth code one-time sang JWT nội bộ)

### 2. Upload ảnh đầu vào

Gọi `POST /assets/upload` với:

- `multipart/form-data`
- field file tên là `file`
- gửi kèm bearer token

Có thể truyền thêm:

- `jobId`
- `type`
- `role`
- `folder`

Nếu không truyền `role`, hệ thống mặc định là `INPUT`.

### 3. Tạo job generate video

Gọi `POST /jobs/video`

Body ví dụ (TI2V có ảnh - khuyến nghị khi muốn bám chủ thể):

```json
{
  "inputAssetId": "uuid-cua-asset-da-upload",
  "prompt": "A girl walking in the rain, cinematic motion",
  "negativePrompt": "blurry, low quality",
  "presetId": "standard_wan22_ti2v"
}
```

Body ví dụ (TI2V text-only - không cần ảnh):

```json
{
  "prompt": "A girl walking in the rain, cinematic motion",
  "negativePrompt": "blurry, low quality",
  "presetId": "standard_wan22_ti2v"
}
```

Các preset hiện có:

- `preview_ltx_i2v`
- `turbo_wan22_i2v_a14b`
- `standard_wan22_ti2v`
- `standard_wan22_ti2v_8s`
- `quality_hunyuan_i2v`

Rule `inputAssetId`:

- `standard_wan22_ti2v` và `standard_wan22_ti2v_8s`: có thể truyền hoặc không truyền `inputAssetId` (TI2V hỗ trợ cả image-conditioned và text-only).
- `preview_ltx_i2v`, `turbo_wan22_i2v_a14b`, `quality_hunyuan_i2v`: bắt buộc có `inputAssetId`.

Rule quyền truy cập preset:

- `turbo_wan22_i2v_a14b` và `quality_hunyuan_i2v` chỉ dành cho tài khoản `PRO`.
- `PRO` có `20` premium credits miễn phí mỗi ngày cho preset premium, không cộng dồn qua ngày tiếp theo.
- Khi tạo job premium, hệ thống ưu tiên trừ phần free theo ngày trước, sau đó mới trừ ví credit.

Mỗi job hiện bị trừ `10` credit. Nếu job fail hoặc bị cancel đúng luồng, hệ thống sẽ hoàn credit.

### 4. Theo dõi tiến độ realtime

Mở SSE:

```http
GET /jobs/:id/events
Authorization: Bearer <access_token>
```

Stream này dùng cho màn chi tiết 1 job, gồm `snapshot`, `status`, `log`, `heartbeat`.

Để hiện toast / banner notification toàn cục cho user hiện tại, mở thêm SSE:

```http
GET /jobs/events/me
Authorization: Bearer <access_token>
```

Event trả về có `type: notification` với các `kind` chính:

- `JOB_QUEUED`
- `JOB_RETRYING`
- `JOB_PROVIDER_FALLBACK`
- `JOB_COMPLETED`
- `JOB_FAILED`
- `JOB_CANCELLED`

### 5. Lấy kết quả

- `GET /jobs/:id`
- `GET /jobs/:id/result`

Kết quả trả về sẽ chứa signed URL để tải video và thumbnail từ S3.

### 6. Billing (MVP)

- `GET /billing/catalog`: lấy bảng giá top-up + gói PRO hiện tại.
- `POST /billing/orders`: tạo đơn thanh toán `MOMO` hoặc `BANK_TRANSFER`.
- `GET /billing/orders/me`: xem lịch sử đơn của user hiện tại.
- `POST /billing/orders/:id/mark-paid`: API nội bộ để test đánh dấu thanh toán thành công (chỉ `ADMIN`).

Lưu ý:

- Luồng webhook MoMo/bank vẫn là bước tích hợp kế tiếp.
- Hiện tại có thể dùng `mark-paid` để test luồng cộng credit và nâng `PRO` end-to-end.

## Scripts hay dùng

```bash
npm run start:dev      # chạy API ở chế độ dev
npm run worker:dev     # chạy worker dev
npm run build          # build production
npm run start:prod     # chạy bản build
npm run test           # unit test
npm run test:e2e       # e2e test
npm run db:backup      # backup PostgreSQL ra file dump
npm run db:restore     # restore PostgreSQL tu file dump (can -DumpFile ... -Force)
npm run env:check:prod # check nhanh env truoc deploy production
npm run railway:deploy # sync env + deploy api/worker len Railway
```

Smoke test turbo end-to-end qua backend:

```powershell
pwsh -File scripts/smoke-test-turbo.ps1 -ImagePath path\to\input.png
```

Benchmark Wan cho cả I2V (có ảnh) và T2V (text-only), in thời gian queue/processing/total:

```powershell
pwsh -File scripts/benchmark-wan-modes.ps1 -Mode Both -ImagePath path\to\input.png
```

Benchmark riêng text-only:

```powershell
pwsh -File scripts/benchmark-wan-modes.ps1 -Mode T2V
```

Smoke test backup/restore PostgreSQL (container tạm, không đụng DB chính):

```powershell
pwsh -File scripts/smoke-test-backup-restore.ps1
```

## Một số lưu ý khi setup

- `RUN_WORKER` phải là `true` thì worker mới thực sự tiêu thụ queue.
- Swagger chỉ là tài liệu API, không thay thế worker. Nếu API chạy mà worker không chạy thì job sẽ đứng ở trạng thái `QUEUED`.
- `DATABASE_URL` và `REDIS_HOST` khác nhau giữa chạy local và chạy bằng Docker Compose.
- Repo đang đọc `.env` trực tiếp từ thư mục gốc bằng `ConfigModule.forRoot`.
- S3 credentials không nên commit thật lên git. Nên dùng key riêng cho môi trường dev.
- Với Gmail SMTP:
  - cần bật 2FA cho tài khoản Gmail
  - cần tạo App Password riêng cho Mail
  - backend hiện tự bỏ khoảng trắng trong `MAIL_APP_PASSWORD`, nên có thể dán cả dạng `xxxx xxxx xxxx xxxx`

## Tài liệu thêm

- [Railway Deploy Runbook](docs/deploy-railway.md)
- [Auth Email + Google OAuth2 Integration Guide](docs/auth-email-oauth2.md)
- [Jobs SSE Integration Guide](docs/jobs-sse.md)
- [Billing Integration Guide (MoMo + payOS)](docs/billing-momo-integration.md)
- [TurboDiffusion Wan2.2 I2V A14B Report](docs/turbodiffusion-wan22-i2v-a14b-report.md)
- [Ops Part 1 - Health Readiness](docs/ops-part-1-health-readiness.md)
- [Ops Part 2 - Rate Limit](docs/ops-part-2-rate-limit.md)
- [Ops Phase 1 - Backup Restore Runbook](docs/ops-phase-1-backup-restore.md)
- [Ops Phase 2 - Logging Monitoring Alert](docs/ops-phase-2-logging-monitoring-alert.md)
- [Ops Rollout Plan (Phased)](docs/ops-rollout-plan-phased.md)
