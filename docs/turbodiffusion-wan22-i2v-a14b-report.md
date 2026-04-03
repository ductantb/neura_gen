# Báo cáo tích hợp TurboDiffusion cho Wan2.2 I2V A14B

Ngày cập nhật: 2026-04-03

## 1. Mục tiêu

Mục tiêu của đợt làm việc này là hoàn thiện khả năng sinh video `image-to-video` bằng model `Wan2.2 I2V A14B` thông qua `TurboDiffusion`, triển khai trên `Modal`, và nối đầy đủ vào backend NestJS hiện tại của dự án.

Kỳ vọng đầu ra:

- Có preset riêng trong hệ thống cho Turbo Wan.
- Có route Modal riêng cho Turbo Wan.
- Có cấu hình deploy phù hợp với GPU `A100-80GB`.
- Có thể chạy end-to-end qua backend:
  - upload ảnh
  - tạo job
  - worker gọi Modal
  - upload video/thumnbail lên S3
  - lấy kết quả cuối cùng từ API

## 2. Kết luận

Việc tích hợp đã hoàn thành.

Hệ thống hiện đã chạy được preset:

- `presetId`: `turbo_wan22_i2v_a14b`
- `modelName`: `wan2.2-i2v-a14b-turbo`
- `workflow`: `I2V`

Đã xác minh thành công ở 2 mức:

- Smoke test trực tiếp trên route Modal Turbo Wan.
- Smoke test end-to-end qua backend NestJS, queue worker, Modal và S3.

TurboDiffusion được dùng theo repo chính thức:

- `https://github.com/thu-ml/TurboDiffusion`

## 3. Các thành phần liên quan

Các file chính được dùng hoặc cập nhật trong đợt tích hợp này:

- `modal_app/video/turbo_wan_app.py`
- `src/modules/modal/modal.service.ts`
- `src/modules/jobs/video-generation.catalog.ts`
- `scripts/deploy-modal.sh`
- `scripts/smoke-test-turbo.ps1`
- `README.md`

## 4. Kiến trúc sau tích hợp

Luồng xử lý của preset turbo như sau:

```text
Client
-> NestJS API
-> PostgreSQL + Redis/BullMQ
-> Worker
-> Modal turbo route
-> TurboDiffusion + Wan2.2 I2V A14B
-> trả video base64
-> Worker upload S3
-> API trả signed URL kết quả
```

Preset turbo được tách thành route Modal riêng thay vì nhét vào `modal_app/video/app.py`.

Lý do:

- TurboDiffusion có dependency nặng và khác biệt so với các route Diffusers thông thường.
- Việc tách route giúp cô lập rủi ro build image.
- Dễ tối ưu GPU, timeout, startup time và cold start riêng.
- Dễ debug và rollout độc lập.

## 5. Trạng thái tích hợp ở backend NestJS

Backend đã có đủ các phần để nhận biết và định tuyến preset turbo:

- Catalog preset có `turbo_wan22_i2v_a14b`.
- `ModalService` route preset này sang env `MODAL_GENERATE_VIDEO_TURBO_WAN_URL`.
- Timeout cho turbo được cấu hình riêng.
- Job metadata lưu đúng:
  - `modelName`
  - `presetId`
  - `workflow`
  - `turboEnabled`

Điểm quan trọng:

- Preset mặc định của hệ thống vẫn là `standard_wan22_ti2v`.
- Turbo Wan là preset explicit, không thay đổi default hiện có.

## 6. Thiết kế route Modal Turbo Wan

File triển khai chính:

- `modal_app/video/turbo_wan_app.py`

Route này dùng:

- app Modal riêng: `neura-video-gen-turbo-wan`
- web endpoint riêng: `generate_video`
- function nội bộ: `generate_turbo_video_core`

### 6.1. Thông số inference chính

Cấu hình hiện tại:

- `resolution`: `720p`
- `aspect_ratio`: `16:9`
- `num_frames`: `81`
- `num_steps`: `4`
- `fps`: `16`

Đây là cấu hình thiên về sự cân bằng giữa:

- tốc độ
- chi phí GPU
- độ ổn định inference
- khả năng chạy production trên A100-80GB

### 6.2. Prompting

Prompt đầu vào được nối thêm hậu tố nhằm:

- giữ chủ thể và bố cục ảnh gốc
- tăng độ rõ của motion
- giảm cảm giác clip bị "đứng hình"

Negative prompt hiện không được dùng trong Turbo route.

Lý do:

- script inference của TurboDiffusion trong luồng này không tận dụng negative prompt như pipeline Diffusers thông thường
- giữ integration đơn giản và ít rủi ro hơn

## 7. Tối ưu cho A100-80GB

Route turbo được tối ưu theo hướng `A100-80GB first`.

Các điểm chính:

- GPU dùng: `A100-80GB`
- tăng `startup_timeout`
- tăng `scaledown_window`
- dùng checkpoint `full` mặc định
- attention mặc định chuyển sang `sagesla`

### 7.1. Vì sao dùng checkpoint full

Với GPU 80GB, không cần ưu tiên bản quantized.

Lợi ích của checkpoint full:

- chất lượng và độ ổn định tốt hơn
- tránh thêm biến số do `quant_linear`
- phù hợp với mục tiêu production inference trên A100 lớn

### 7.2. Vì sao attention mặc định là `sagesla`

`sagesla` phù hợp với định hướng tăng hiệu năng cho TurboDiffusion.

So với `original`, nó phù hợp hơn cho mục tiêu:

- tăng throughput
- giảm bottleneck attention
- tận dụng tốt hơn cấu hình A100 lớn

### 7.3. Build SpargeAttn cho A100

Khi thử build ban đầu, `SpargeAttn` lỗi do builder không tự nhận GPU architecture.

Giải pháp đã áp dụng:

- build với `TORCH_CUDA_ARCH_LIST=8.0`

Điều này khớp với kiến trúc GPU A100.

## 8. Runtime assets và cache

Route turbo sử dụng `Modal Volume` để cache model/runtime assets tại:

- `/cache`

Các asset chính:

- high-noise checkpoint
- low-noise checkpoint
- VAE
- text encoder

Đã bổ sung function:

- `prefetch_runtime_assets`

Mục đích:

- tải sẵn model weights vào volume
- giảm cold start cho lần chạy đầu
- giúp deploy xong có thể "warm" route trước khi chạy thật

## 9. Thêm TurboDiffusion đúng cách vào mô hình turbo

TurboDiffusion ở đây không chỉ là tên preset, mà là dependency/runtime thực tế đã được tích hợp:

- clone repo `thu-ml/TurboDiffusion`
- init submodule `cutlass`
- `pip install -e .`
- build thêm `SpargeAttn`

Ngoài ra image cũng được bổ sung:

- `hf_transfer`
- biến môi trường `HF_HUB_ENABLE_HF_TRANSFER=1`

Mục đích:

- tăng tốc tải checkpoint lớn từ Hugging Face
- giảm thời gian warmup và deploy

## 10. Env vars và vận hành

Biến môi trường backend liên quan:

- `MODAL_GENERATE_VIDEO_URL`
- `MODAL_GENERATE_VIDEO_TURBO_WAN_URL`
- `MODAL_GENERATE_VIDEO_WAN_URL`
- `MODAL_GENERATE_VIDEO_HUNYUAN_URL`

Biến môi trường tùy chọn cho turbo app:

- `TURBO_WAN_ATTENTION_TYPE=original|sla|sagesla`
- `TURBO_WAN_USE_QUANTIZED_CHECKPOINTS=true|false`
- `TURBO_WAN_USE_ODE=true|false`
- `TURBO_WAN_SLA_TOPK`
- `TURBO_WAN_BOUNDARY`
- `TURBO_WAN_SIGMA_MAX`

Khuyến nghị production hiện tại:

- `TURBO_WAN_ATTENTION_TYPE=sagesla`
- `TURBO_WAN_USE_QUANTIZED_CHECKPOINTS=false`
- `TURBO_WAN_USE_ODE=false`

## 11. Deploy đã thực hiện

Route turbo đã được deploy thành công trên tài khoản Modal mới.

Biến env backend local hiện đã trỏ đúng route turbo mới qua:

- `MODAL_GENERATE_VIDEO_TURBO_WAN_URL`

Quy trình deploy tiêu chuẩn:

```bash
modal deploy modal_app/video/turbo_wan_app.py
modal run modal_app/video/turbo_wan_app.py::prefetch_runtime_assets
```

Hoặc dùng script:

```bash
./scripts/deploy-modal.sh deploy turbo
```

## 12. Smoke test đã thực hiện

### 12.1. Smoke test trực tiếp trên Modal

Đã gọi trực tiếp route Modal turbo với ảnh public hợp lệ.

Kết quả thành công:

- `status`: `ok`
- `preset_id`: `turbo_wan22_i2v_a14b`
- `workflow`: `I2V`
- `attention_type`: `sagesla`
- `checkpoint_variant`: `full`

Một lần test thành công có số liệu:

- `elapsed_seconds`: `405.29`
- `inference_seconds`: `400.32`
- `asset_download_seconds`: `4.9`

### 12.2. Smoke test end-to-end qua backend

Đã chạy thành công qua backend bằng script:

- `scripts/smoke-test-turbo.ps1`

Chuỗi thực hiện:

- đăng ký user test mới
- upload ảnh mẫu
- tạo job với preset turbo
- poll job result
- xác nhận kết quả `COMPLETED`

Job test thành công:

- `jobId`: `bc502bf1-ab12-4e69-802f-2768a0e982a0`

Kết quả cuối:

- `status`: `COMPLETED`
- `creditCost`: `15`
- `provider`: `modal`
- `modelName`: `wan2.2-i2v-a14b-turbo`
- `presetId`: `turbo_wan22_i2v_a14b`
- `tier`: `turbo`
- `workflow`: `I2V`

Output đã được lưu lên S3:

- video `.mp4`
- thumbnail `.jpg`

## 13. Quan sát từ quá trình chạy thật

Trong job end-to-end, progress backend dừng khá lâu ở mốc `30`.

Điều này là bình thường với thiết kế hiện tại vì:

- sau mốc `30`, worker đang chờ Modal inference hoàn tất
- progress hiện là milestone backend, không phải percent thật từ model

Khi inference xong:

- progress nhảy lên `80`
- sau upload S3 và tạo thumbnail thì lên `100`

## 14. Rủi ro và lưu ý vận hành

### 14.1. Thời gian chạy

Turbo Wan vẫn không phải "real-time".

Thời gian chạy thực tế trong môi trường hiện tại vào khoảng:

- 340 đến 405 giây cho 1 clip test

Điều này vẫn nhanh hơn cấu hình video chất lượng cao nặng hơn, nhưng chưa phải mức preview siêu nhanh.

### 14.2. Cold start

Cold start sẽ nặng nếu chưa prefetch weights.

Khuyến nghị:

- sau mỗi deploy nên chạy `prefetch_runtime_assets`

### 14.3. Rate limit Hugging Face

Hiện runtime có thể tải weights không cần `HF_TOKEN`, nhưng tốc độ và hạn mức sẽ kém hơn.

Khuyến nghị production:

- thêm `HF_TOKEN` vào Modal Secret nếu muốn tải ổn định hơn

### 14.4. Chi phí

Vì route turbo chạy trên `A100-80GB`, chi phí GPU vẫn đáng kể.

Nên dùng preset này cho:

- tác vụ cần chất lượng/tốc độ tốt hơn preview
- job explicit do người dùng chọn

## 15. Những gì đã hoàn thành

- Hoàn thiện route Modal riêng cho TurboDiffusion Wan2.2 I2V A14B.
- Tối ưu cấu hình cho `A100-80GB`.
- Tích hợp build `TurboDiffusion` và `SpargeAttn`.
- Thêm cơ chế prefetch model assets vào `Modal Volume`.
- Nối backend NestJS tới route turbo riêng.
- Cập nhật script deploy.
- Thêm script smoke test end-to-end qua backend.
- Xác nhận bằng test thực tế trên route Modal.
- Xác nhận bằng test thực tế end-to-end qua backend.

## 16. Khuyến nghị bước tiếp theo

Các hướng nên làm tiếp:

- ghi log inference chi tiết hơn ở worker và Modal để dễ debug production
- bổ sung endpoint hoặc log lưu `elapsed_seconds`, `inference_seconds` vào metadata asset/job
- thử thêm profile khác của TurboDiffusion:
  - giảm `num_frames`
  - giảm `num_steps`
  - bật `ODE`
  - thử `quantized checkpoints`
- thêm một preset turbo "fast" riêng nếu muốn rút thời gian inference hơn nữa

## 17. Lệnh tham khảo

Deploy turbo route:

```bash
modal deploy modal_app/video/turbo_wan_app.py
```

Warm runtime assets:

```bash
modal run modal_app/video/turbo_wan_app.py::prefetch_runtime_assets
```

Smoke test end-to-end qua backend:

```powershell
pwsh -File scripts/smoke-test-turbo.ps1 -ImagePath path\to\input.png
```

## 18. Kết luận cuối

Tại thời điểm 2026-04-03, việc sử dụng `TurboDiffusion` cho `Wan2.2 I2V A14B` trong dự án này đã hoàn tất ở mức production-ready cơ bản:

- deploy được
- chạy được
- có route riêng
- có cache/prefetch
- đã đi xuyên qua backend thật
- đã trả kết quả thật về S3

Phần việc còn lại, nếu muốn nâng cấp thêm, chủ yếu là tối ưu hiệu năng và tăng khả năng quan sát vận hành, không còn là bài toán "tích hợp được hay chưa".
