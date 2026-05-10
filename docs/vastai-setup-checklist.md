# Vast Setup Checklist (Current UI, 2026-05)

Tai lieu nay la checklist thao tac thuc te de setup Vast cho repo nay.

## 1) Chon dung mode tren Vast

Khuyen nghi:
- Dung **Instances mode (direct HTTP)**.

Ly do:
- Backend can URL co dinh: `VAST_GENERATE_VIDEO_URL`.
- De debug va de thay GPU nhanh.

Luu y UI Vast hien tai:
- Tao **Serverless Endpoint** khong hien field port/path nhu truoc.
- Port/path nam o runtime instance/container.

## 2) Build va push image Vast

Tu root repo:

```bash
docker build -f modal_app/video/Dockerfile.vast -t ghcr.io/<org>/<repo>:vast-v3 .
docker push ghcr.io/<org>/<repo>:vast-v3
```

## 3) Tao instance tren Vast

Tai `cloud.vast.ai/create`:
1. Filter GPU (co the bat dau RTX 3090/4090 de tiet kiem chi phi).
2. Chon offer reliability cao, rentable.
3. Chon image: `ghcr.io/<org>/<repo>:vast-v3`.
4. Expose container port `8000`.
5. Launch instance.

Sau khi running:
- Lay `PUBLIC_IP` va `MAPPED_PORT`.
- URL:
- `http://<PUBLIC_IP>:<MAPPED_PORT>/health`
- `http://<PUBLIC_IP>:<MAPPED_PORT>/invoke`

## 4) Test endpoint tren Vast truoc khi gan vao backend

Health:

```bash
curl http://<PUBLIC_IP>:<MAPPED_PORT>/health
```

Wan standard smoke:

```bash
curl -X POST http://<PUBLIC_IP>:<MAPPED_PORT>/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cinematic rainy street at dusk",
    "jobId": "smoke-vast-001",
    "presetId": "standard_wan22_ti2v",
    "modelName": "wan2.2-ti2v-standard",
    "workflow": "T2V"
  }'
```

## 5) Dien env backend

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

Sau do restart API + worker.

## 6) Model support matrix (image vast-v3)

Supported tren Vast image:
- `preview_ltx_i2v` / `ltx-video-i2v-preview`
- `standard_wan22_ti2v`, `standard_wan22_ti2v_8s` / `wan2.2-ti2v-standard`
- `quality_hunyuan_i2v` / `hunyuan-video-i2v-quality`

Khong bundle:
- `turbo_wan22_i2v_a14b` / `wan2.2-i2v-a14b-turbo`

Hanh vi turbo:
- Vast se tra non-retryable 400.
- Worker fallback sang Modal neu plan la `vast -> modal`.

## 7) OOM optimization da bat san (khong doi quality preset)

Image da bat:
- `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True,max_split_size_mb:128`
- `WAN_USE_CPU_OFFLOAD=true`
- `WAN_CPU_OFFLOAD_MODE=sequential`
- `WAN_ENABLE_ATTENTION_SLICING=true`
- `WAN_ENABLE_VAE_TILING=true`
- `WAN_ENABLE_VAE_SLICING=true`
- `uvicorn --workers 1`

Tac dong:
- Giam peak VRAM, tranh OOM tren 24GB class GPU.
- Runtime cham hon so voi full-GPU mode.
- Khong thay doi `num_frames/steps/resolution` cua preset.

## 8) E2E smoke test trong he thong

Can chay:
1. 1 job Wan standard (`standard_wan22_ti2v`)
2. 1 job LTX preview (`preview_ltx_i2v`)
3. 1 job Hunyuan quality (`quality_hunyuan_i2v`)

Pass:
- Job completed
- Co video + thumbnail
- Log co provider metadata (`provider`, `providerAttempt`, `fallbackTriggered`)

## 9) Doi GPU khi can ma khong doi code

1. Stop instance cu.
2. Thue instance moi.
3. Cap nhat `VAST_GENERATE_VIDEO_URL` + `VAST_HEALTHCHECK_URL`.
4. Restart API + worker.
5. Chay smoke test lai.

## 10) Troubleshooting nhanh

Loi 400 unsupported model/preset:
- Kiem tra `modelName`, `presetId`.
- Neu la turbo thi ky vong fallback Modal.

Loi OOM:
- Xac nhan dang dung image moi `vast-v3`.
- Xac nhan instance dang chay 1 worker.
- Thu recreate instance neu worker da bi dirty memory state.

Loi timeout:
- Tang `VAST_REQUEST_TIMEOUT_MS`.
- Kiem tra network quality cua host Vast.
