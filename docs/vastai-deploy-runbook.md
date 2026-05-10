# VastAI Deploy Runbook (As-Built)

Tai lieu nay mo ta trang thai da trien khai thuc te trong repo, khong phai ban thiet ke.

## 1) Muc tieu

- User khong chon provider.
- Backend tu route noi bo theo `vast -> modal`.
- Vast duoc dung de toi uu chi phi, Modal la fallback an toan.
- Doi GPU Vast khong doi API contract frontend.

## 2) Kien truc provider routing hien tai

Provider plan:
- `VIDEO_PROVIDER_PRIMARY=vast`
- `VIDEO_PROVIDER_FALLBACK=modal`

Luong xu ly cho 1 job:
1. Worker lay `providerPlan` (tu `extraConfig` hoac env default).
2. Thu provider dau tien (`vast`).
3. Neu thanh cong: chot ket qua.
4. Neu that bai:
- Loi retryable: retry theo `*_MAX_RETRIES`.
- Het retry: chuyen fallback provider tiep theo.
- Loi non-retryable tren Vast: neu con provider sau thi van fallback sang Modal.
5. Tat ca provider that bai: job `FAILED` + refund.

## 3) Circuit breaker Vast (da co)

Bien cau hinh:
- `VAST_BREAKER_FAILURE_THRESHOLD`
- `VAST_BREAKER_WINDOW_SECONDS`
- `VAST_BREAKER_COOLDOWN_SECONDS`
- `VAST_BREAKER_HALF_OPEN_SUCCESS`

Hanh vi:
- Vast loi transient/OOM lap lai vuot nguong -> mo breaker.
- Breaker mo -> worker tam bo qua Vast, chay Modal.
- Het cooldown -> half-open; dat du so lan thanh cong -> dong breaker.

## 4) Error taxonomy va fallback

Retryable:
- timeout/network
- 5xx
- 429 truong hop khong phai billing limit
- OOM/CUDA (xep transient OOM)

Non-retryable:
- 4xx input/business (preset/model/workflow khong hop le)
- 429 billing cycle spend limit reached

Luu y quan trong:
- Non-retryable tren provider hien tai khong co nghia fail ngay.
- Neu con fallback provider trong plan thi worker van chuyen sang fallback.

## 5) Model support tren Vast image standard hien tai

Ho tro truc tiep tren `modal_app/video/Dockerfile.vast` + `vast_server.py`:
- `preview_ltx_i2v` / `ltx-video-i2v-preview`
- `standard_wan22_ti2v`, `standard_wan22_ti2v_8s` / `wan2.2-ti2v-standard`
- `quality_hunyuan_i2v` / `hunyuan-video-i2v-quality`

Khong bundle trong image nay:
- `turbo_wan22_i2v_a14b` / `wan2.2-i2v-a14b-turbo`

Voi turbo:
- Vast tra error 400 co chu de khong ho tro turbo.
- Worker fallback sang Modal neu plan con `modal`.

## 6) Vast runtime artifacts trong repo

- `modal_app/video/vast_server.py`
- `modal_app/video/Dockerfile.vast`
- `modal_app/video/requirements-vast.txt`
- `modal_app/video/.dockerignore.vast`
- `src/modules/modal/vast.service.ts`
- `src/workers/video.worker.ts`
- `src/workers/video.worker.spec.ts`
- `src/modules/modal/vast.service.spec.ts`

## 7) Env can co o backend

```env
VIDEO_PROVIDER_PRIMARY=vast
VIDEO_PROVIDER_FALLBACK=modal
PROVIDER_ROUTE_POLICY=vast_then_modal

VAST_ENABLED=true
VAST_GENERATE_VIDEO_URL=http://<PUBLIC_IP>:<MAPPED_PORT>/invoke
VAST_HEALTHCHECK_URL=http://<PUBLIC_IP>:<MAPPED_PORT>/health
VAST_REQUEST_TIMEOUT_MS=2700000
VAST_MAX_RETRIES=1
MODAL_MAX_RETRIES=1

VAST_BREAKER_FAILURE_THRESHOLD=3
VAST_BREAKER_WINDOW_SECONDS=300
VAST_BREAKER_COOLDOWN_SECONDS=600
VAST_BREAKER_HALF_OPEN_SUCCESS=3
```

Legacy key:
- `VAST_GENERATE_VIDEO_WAN_URL` van duoc chap nhan trong service, nhung hien tai nen dung `VAST_GENERATE_VIDEO_URL` duy nhat.

## 8) Van hanh doi GPU Vast (khong doi code)

1. Stop instance cu.
2. Rent instance moi (GPU khac).
3. Lay URL moi `/health` va `/invoke`.
4. Cap nhat 2 env URL.
5. Restart API + worker.
6. Chay smoke test.

## 9) Smoke test toi thieu

Can test 3 case:
1. `standard_wan22_ti2v` (T2V hoac TI2V)
2. `preview_ltx_i2v` (I2V)
3. `quality_hunyuan_i2v` (I2V)

Case turbo:
- Co the test de xac nhan fallback Vast -> Modal.

Pass criteria:
- Job `QUEUED -> PROCESSING -> COMPLETED`
- Co output video + thumbnail
- SSE/log co `provider`, `providerAttempt`, `fallbackTriggered`

## 10) Rollback

Neu Vast bat on:
1. Chuyen `VIDEO_PROVIDER_PRIMARY=modal` tam thoi, hoac
2. Giu plan nhung tat Vast (`VAST_ENABLED=false`), hoac
3. Giu Vast va de breaker tu dong skip.

Sau rollback:
- Chay lai smoke test truoc khi mo traffic full.
