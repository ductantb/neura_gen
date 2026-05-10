# Vast Standard Baseline (Wan 2.2 TI2V)

Tai lieu nay la baseline cau hinh cho preset standard khi chay voi route `vast -> modal`.

## 1) Preset chuan

- Preset ID: `standard_wan22_ti2v`
- Preset ID (8s): `standard_wan22_ti2v_8s`
- Model: `wan2.2-ti2v-standard`
- Workflow hop le: `TI2V`, `I2V`, `T2V`

## 2) Thong so generation (khong doi quality)

Dung theo `modal_app/video/app.py`:
- `WAN_MAX_AREA = 480 * 832`
- `WAN_NUM_INFERENCE_STEPS = 32`
- `WAN_GUIDANCE_SCALE = 4.5`
- `WAN_VIDEO_FPS = 24`

Profile 5s:
- `num_frames = 81`
- `preset_id = standard_wan22_ti2v`
- `debug_version = modal_wan22_ti2v_standard_v3_5s`

Profile 8s:
- `num_frames = 121`
- `preset_id = standard_wan22_ti2v_8s`
- `debug_version = modal_wan22_ti2v_standard_v3_8s`

## 3) Timeout baseline backend

- Vast timeout: `VAST_REQUEST_TIMEOUT_MS` (khuyen nghi 45 phut)
- Modal timeout:
- standard 5s: 45 phut
- standard 8s: 60 phut

## 4) Memory optimization mode tren Vast image

Da bat mac dinh trong `Dockerfile.vast`:
- `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True,max_split_size_mb:128`
- `WAN_USE_CPU_OFFLOAD=true`
- `WAN_CPU_OFFLOAD_MODE=sequential`
- `WAN_ENABLE_ATTENTION_SLICING=true`
- `WAN_ENABLE_VAE_TILING=true`
- `WAN_ENABLE_VAE_SLICING=true`

Muc tieu:
- Giam OOM tren 24GB VRAM class (RTX 3090/4090).
- Giu nguyen profile quality preset.

Trade-off:
- Latency tang.

## 5) Input contract toi thieu

T2V standard:

```json
{
  "prompt": "A cinematic rainy street at dusk",
  "presetId": "standard_wan22_ti2v",
  "modelName": "wan2.2-ti2v-standard",
  "workflow": "T2V"
}
```

TI2V/I2V:
- Can `inputImageUrl`.

## 6) Van hanh voi 1 GPU Vast

Quy tac:
- Chay 1 instance tai 1 thoi diem.
- Doi GPU thi doi URL env, khong doi payload contract.

Buoc doi GPU:
1. Stop instance cu.
2. Rent instance moi.
3. Update `VAST_GENERATE_VIDEO_URL`, `VAST_HEALTHCHECK_URL`.
4. Restart API + worker.
5. Smoke test lai standard preset.

## 7) Pass criteria cho standard

- Job `COMPLETED`.
- Co file video + thumbnail trong storage.
- SSE/log co provider metadata.
- Neu Vast loi thi fallback Modal thanh cong.
