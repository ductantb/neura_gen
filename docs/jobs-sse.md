# Jobs SSE Integration Guide

Tai lieu nay mo ta chi tiet luong realtime cho job video, bao gom:

- stream theo tung job de render progress/log trong man chi tiet
- stream notification theo user de hien toast/banner toan cuc
- payload chinh xac cua tung event
- cac case retry, fallback provider, fail, cancel

Guide nay phan anh implementation hien tai trong:

- `src/modules/jobs/job-events.service.ts`
- `src/modules/jobs/jobs.controller.ts`
- `src/modules/jobs/jobs.service.ts`
- `src/workers/video.worker.ts`

## 1. Tong quan kien truc

Luong realtime cua module jobs duoc tach thanh 2 lop:

1. Worker / service cap nhat trang thai job va tao log.
2. `JobEventsService` publish su kien qua Redis Pub/Sub.
3. Controller expose SSE cho client consume.

Hien tai co 2 kenh SSE:

- `GET /jobs/:id/events`
  - Theo doi timeline chi tiet cua 1 job.
  - Dung cho trang job detail, progress bar, log runtime.
- `GET /jobs/events/me`
  - Theo doi notification toan cuc cua user dang dang nhap.
  - Dung cho toast, banner, notification center nhe.

## 2. Authentication va header

Tat ca endpoint jobs SSE deu yeu cau:

- `Authorization: Bearer <access_token>`
- `Accept: text/event-stream`

Luu y:

- Browser `EventSource` native khong gui duoc `Authorization` header.
- Neu frontend can dung Bearer JWT, nen dung client cho phep custom header nhu `fetch-event-source` hoac tu mo stream bang `fetch`.

## 3. Endpoint 1: stream theo job

### Route

```http
GET /jobs/:id/events
Authorization: Bearer <access_token>
Accept: text/event-stream
```

### Muc dich

Dung khi client can:

- hien progress theo phan tram
- render log runtime
- cap nhat trang thai `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`
- dong bo metadata nhu `provider`, `presetId`, `workflow`

### Event type

Kenh nay phat 4 loai event:

- `snapshot`
- `status`
- `log`
- `heartbeat`

### Thu tu event

Khi client vua subscribe:

1. server gui ngay 1 `snapshot`
2. sau do moi bat dau gui `status` / `log`
3. heartbeat duoc gui dinh ky moi `15s`

`snapshot` la anh chup nhanh hien trang cua job o thoi diem subscribe, giup client khoi tao UI ma khong can goi them API rieng.

### `snapshot`

```text
event: snapshot
data: {...}
```

Payload:

```json
{
  "jobId": "uuid",
  "status": "PENDING|QUEUED|PROCESSING|COMPLETED|FAILED|CANCELLED",
  "progress": 60,
  "errorMessage": null,
  "provider": "modal",
  "modelName": "wan2.2-ti2v-standard",
  "presetId": "standard_wan22_ti2v",
  "tier": "standard",
  "estimatedDurationSeconds": 420,
  "workflow": "I2V|T2V|TI2V|null",
  "includeBackgroundAudio": true,
  "createdAt": "2026-05-07T10:00:00.000Z",
  "updatedAt": "2026-05-07T10:03:00.000Z",
  "startedAt": "2026-05-07T10:00:10.000Z",
  "completedAt": null,
  "failedAt": null,
  "logs": [
    {
      "jobId": "uuid",
      "message": "Job queued",
      "createdAt": "2026-05-07T10:00:02.000Z"
    }
  ]
}
```

### `status`

```text
event: status
data: {...}
```

Payload:

```json
{
  "jobId": "uuid",
  "status": "QUEUED|PROCESSING|COMPLETED|FAILED|CANCELLED",
  "progress": 80,
  "errorMessage": null,
  "startedAt": "2026-05-07T10:00:10.000Z",
  "completedAt": null,
  "failedAt": null,
  "occurredAt": "2026-05-07T10:02:30.000Z",
  "provider": "modal",
  "providerAttempt": 1,
  "fallbackTriggered": false
}
```

Y nghia them:

- `provider`: provider dang duoc dung cho lan cap nhat nay.
- `providerAttempt`: so lan thu tren provider hien tai.
- `fallbackTriggered`:
  - `false`: chua co fallback provider
  - `true`: da co fallback hoac status nay xay ra sau khi fallback

### `log`

```text
event: log
data: {...}
```

Payload:

```json
{
  "jobId": "uuid",
  "message": "Provider modal succeeded on attempt 1",
  "createdAt": "2026-05-07T10:02:10.000Z",
  "provider": "modal",
  "providerAttempt": 1,
  "fallbackTriggered": false
}
```

### `heartbeat`

```text
event: heartbeat
data: {...}
```

Payload:

```json
{
  "jobId": "uuid",
  "timestamp": "2026-05-07T10:02:15.000Z"
}
```

Client co the bo qua `heartbeat`, hoac dung de:

- xac nhan ket noi van con song
- restart stream neu qua lau khong nhan duoc heartbeat

## 4. Endpoint 2: notification theo user

### Route

```http
GET /jobs/events/me
Authorization: Bearer <access_token>
Accept: text/event-stream
```

### Muc dich

Kenh nay khong gan voi 1 job cu the trong UI, ma dung de hien:

- toast "video da xong"
- banner "job dang retry"
- canh bao "he thong dang fallback sang provider khac"
- thong bao "job bi loi" hoac "da huy"

### Event type

Kenh nay chi phat 1 loai event:

- `notification`

Raw SSE:

```text
event: notification
data: {...}
```

Payload:

```json
{
  "userId": "uuid",
  "jobId": "uuid",
  "kind": "JOB_COMPLETED",
  "severity": "success",
  "title": "Video generation completed",
  "message": "Your video is ready to view and download.",
  "status": "COMPLETED",
  "progress": 100,
  "provider": "modal",
  "modelName": "wan2.2-ti2v-standard",
  "presetId": "standard_wan22_ti2v",
  "workflow": "T2V",
  "errorMessage": null,
  "resultReady": true,
  "occurredAt": "2026-05-07T10:05:00.000Z"
}
```

### Cac `kind` hien co

#### `JOB_QUEUED`

Phat khi:

- request tao job thanh cong
- job da duoc enqueue vao BullMQ

Thuong dung de hien:

- "Da dua yeu cau vao hang doi"

#### `JOB_RETRYING`

Phat khi:

- 1 attempt trong worker bi loi
- loi duoc xem la retryable
- queue van con lan retry tiep theo

Thuong dung de hien:

- "He thong dang thu lai tu dong"

#### `JOB_PROVIDER_FALLBACK`

Phat khi:

- provider hien tai tra loi non-retryable nhung con provider fallback, hoac
- provider hien tai retry het lan va he thong chuyen qua provider tiep theo

Thuong dung de hien:

- "Dang chuyen sang provider du phong"

#### `JOB_COMPLETED`

Phat khi:

- video da generate xong
- output video da upload len storage
- thumbnail da duoc tao va luu
- job da duoc danh dau `COMPLETED`

`resultReady = true`

#### `JOB_FAILED`

Phat khi:

- enqueue vao queue that bai, hoac
- worker fail o lan cuoi cung

Thuong di kem:

- `errorMessage`
- message thong bao credit duoc refund neu co

#### `JOB_CANCELLED`

Phat khi:

- user cancel job thanh cong

Thuong di kem:

- `status = CANCELLED`
- thong diep refund neu job co bi tru credit

## 5. Mapping lifecycle thuc te

Mot job thong thuong se co trinh tu xap xi:

1. `POST /jobs/video`
2. notification `JOB_QUEUED`
3. job stream `status = QUEUED`
4. job stream `status = PROCESSING`
5. nhieu `log` trong qua trinh goi provider
6. neu co loi tam thoi:
   - notification `JOB_RETRYING`
   - job stream `status = QUEUED`
7. neu can fallback:
   - notification `JOB_PROVIDER_FALLBACK`
   - log cho thay switch provider
8. neu thanh cong:
   - job stream `status = COMPLETED`
   - notification `JOB_COMPLETED`
9. neu that bai vinh vien:
   - job stream `status = FAILED`
   - notification `JOB_FAILED`

## 6. Nguon phat event trong backend

### Event theo job

Duoc phat boi `JobEventsService` va stream qua Redis channel:

- `jobs:events:<jobId>`

Nguon goi chu yeu:

- `JobsService`
  - khi queue thanh cong / that bai
  - khi cancel job
- `VideoWorker`
  - trong qua trinh update progress
  - khi tao log runtime
  - khi completed / failed

### Notification theo user

Duoc phat qua Redis channel:

- `jobs:notifications:<userId>`

Nguon goi chu yeu:

- `JobsService`
  - `JOB_QUEUED`
  - `JOB_FAILED` do queue enqueue fail
  - `JOB_CANCELLED`
- `VideoWorker`
  - `JOB_RETRYING`
  - `JOB_PROVIDER_FALLBACK`
  - `JOB_COMPLETED`
  - `JOB_FAILED` o lan fail cuoi

## 7. Hanh vi reconnect va dong bo

### `GET /jobs/:id/events`

Khi reconnect:

- client se nhan lai `snapshot` moi
- co the dung snapshot de lam nguon su that cuoi cung

### `GET /jobs/events/me`

Kenh notification hien tai la realtime-only:

- khong co snapshot dau stream
- khong replay lai notification da bo lo
- neu client mat ket noi, can dong bo lai bang:
  - `GET /jobs`
  - `GET /jobs/:id`
  - `GET /jobs/:id/result`

Khuyen nghi de-dupe o client:

- key de-dupe co the la `jobId + kind + occurredAt`

## 8. Luong loi va cac luu y quan trong

### Queue fail som

Neu `videoQueue.add(...)` loi:

- job duoc mark `FAILED`
- credit duoc refund neu can
- notification `JOB_FAILED` duoc phat ngay

### Cancel trong luc worker dang chay

Neu user cancel khi worker dang xu ly:

- service van mark job `CANCELLED`
- worker kiem tra lai status o cac moc quan trong
- worker se dung som khi phat hien da cancel

### Notification khong thay the API ket qua

`JOB_COMPLETED` chi bao hieu:

- job da xong va client nen refresh data

De lay ket qua dung cho playback / download, van nen goi:

- `GET /jobs/:id/result`

## 9. Rate limit hien tai

- `GET /jobs/:id/events`: `30` request / `60s`
- `GET /jobs/events/me`: `30` request / `60s`
- `POST /jobs/video`: `20` request / `60s`
- `POST /jobs/:id/cancel`: `20` request / `60s`

Neu frontend auto reconnect, nen co backoff de tranh vuot throttle.

## 10. Vi du raw SSE

### Job detail stream

```text
event: snapshot
data: {"jobId":"job-1","status":"QUEUED","progress":1,"errorMessage":null,"provider":"modal","modelName":"wan2.2-ti2v-standard","presetId":"standard_wan22_ti2v","tier":"standard","estimatedDurationSeconds":420,"workflow":"T2V","includeBackgroundAudio":true,"createdAt":"2026-05-07T10:00:00.000Z","updatedAt":"2026-05-07T10:00:01.000Z","startedAt":null,"completedAt":null,"failedAt":null,"logs":[{"jobId":"job-1","message":"Job queued","createdAt":"2026-05-07T10:00:01.000Z"}]}

event: status
data: {"jobId":"job-1","status":"PROCESSING","progress":60,"errorMessage":null,"startedAt":"2026-05-07T10:00:10.000Z","completedAt":null,"failedAt":null,"occurredAt":"2026-05-07T10:01:00.000Z","provider":"modal","providerAttempt":1,"fallbackTriggered":false}

event: log
data: {"jobId":"job-1","message":"Provider modal succeeded on attempt 1","createdAt":"2026-05-07T10:01:05.000Z","provider":"modal","providerAttempt":1,"fallbackTriggered":false}
```

### User notification stream

```text
event: notification
data: {"userId":"user-1","jobId":"job-1","kind":"JOB_COMPLETED","severity":"success","title":"Video generation completed","message":"Your video is ready to view and download.","status":"COMPLETED","progress":100,"provider":"modal","modelName":"wan2.2-ti2v-standard","presetId":"standard_wan22_ti2v","workflow":"T2V","errorMessage":null,"resultReady":true,"occurredAt":"2026-05-07T10:05:00.000Z"}
```

## 11. Checklist test backend

Da co test cho cac phan sau:

- unit test `JobEventsService`
- unit test `JobsController`
- unit test `JobsService`
- unit test `VideoWorker`
- e2e test route `GET /jobs/events/me`

Lenh da dung:

```bash
npm test -- --runInBand
npm run test:e2e -- --runInBand
npx tsc -p tsconfig.json --noEmit
```
