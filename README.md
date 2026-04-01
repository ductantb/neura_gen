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

# Modal endpoints
MODAL_GENERATE_VIDEO_URL=https://your-ltx-endpoint.modal.run
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
```

### Ý nghĩa nhanh của các biến quan trọng

- `DATABASE_URL`: chuỗi kết nối PostgreSQL
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: secret để ký token
- `MODAL_GENERATE_VIDEO_URL`: endpoint preset `preview_ltx_i2v`
- `MODAL_GENERATE_VIDEO_WAN_URL`: endpoint preset `standard_wan22_ti2v`
- `MODAL_GENERATE_VIDEO_HUNYUAN_URL`: endpoint preset `quality_hunyuan_i2v`
- `REDIS_HOST`, `REDIS_PORT`: Redis cho BullMQ
- `RUN_WORKER`: bật/tắt worker trong tiến trình hiện tại
- `AWS_*`, `AWS_S3_BUCKET`: cấu hình lưu file lên S3

Lưu ý:

- Preset mặc định của hệ thống là `standard_wan22_ti2v`.
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

Repo đã có mã nguồn inference trong [modal_app/video/app.py](modal_app/video/app.py).

Nếu bạn chưa có endpoint Modal:

```bash
pip install modal
modal token new
modal deploy modal_app/video/app.py
```

Sau khi deploy, lấy các URL endpoint Modal và điền vào:

- `MODAL_GENERATE_VIDEO_URL`
- `MODAL_GENERATE_VIDEO_WAN_URL`
- `MODAL_GENERATE_VIDEO_HUNYUAN_URL` nếu có route tương ứng

Lưu ý:

- File `modal_app/video/app.py` hiện có route cho LTX preview và Wan 2.2.
- Biến `MODAL_GENERATE_VIDEO_HUNYUAN_URL` chỉ cần khi bạn có endpoint Hunyuan riêng.

## Luồng sử dụng cơ bản

### 1. Đăng ký hoặc đăng nhập

- `POST /auth/register`
- `POST /auth/login`

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

Body ví dụ:

```json
{
  "inputAssetId": "uuid-cua-asset-da-upload",
  "prompt": "A girl walking in the rain, cinematic motion",
  "negativePrompt": "blurry, low quality",
  "presetId": "standard_wan22_ti2v"
}
```

Các preset hiện có:

- `preview_ltx_i2v`
- `standard_wan22_ti2v`
- `quality_hunyuan_i2v`

Mỗi job hiện bị trừ `10` credit. Nếu job fail hoặc bị cancel đúng luồng, hệ thống sẽ hoàn credit.

### 4. Theo dõi tiến độ realtime

Mở SSE:

```http
GET /jobs/:id/events
Authorization: Bearer <access_token>
```

Tài liệu chi tiết nằm ở [docs/jobs-sse.md](docs/jobs-sse.md).

### 5. Lấy kết quả

- `GET /jobs/:id`
- `GET /jobs/:id/result`

Kết quả trả về sẽ chứa signed URL để tải video và thumbnail từ S3.

## Scripts hay dùng

```bash
npm run start:dev      # chạy API ở chế độ dev
npm run worker:dev     # chạy worker dev
npm run build          # build production
npm run start:prod     # chạy bản build
npm run test           # unit test
npm run test:e2e       # e2e test
```

## Một số lưu ý khi setup

- `RUN_WORKER` phải là `true` thì worker mới thực sự tiêu thụ queue.
- Swagger chỉ là tài liệu API, không thay thế worker. Nếu API chạy mà worker không chạy thì job sẽ đứng ở trạng thái `QUEUED`.
- `DATABASE_URL` và `REDIS_HOST` khác nhau giữa chạy local và chạy bằng Docker Compose.
- Repo đang đọc `.env` trực tiếp từ thư mục gốc bằng `ConfigModule.forRoot`.
- S3 credentials không nên commit thật lên git. Nên dùng key riêng cho môi trường dev.

## Tài liệu thêm

- [Jobs SSE Integration Guide](docs/jobs-sse.md)
