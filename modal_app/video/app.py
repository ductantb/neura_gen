import base64
import hashlib
import os
import tempfile
from io import BytesIO

import modal
from pydantic import BaseModel, Field

MODEL_CACHE_DIR = "/cache"
LTX_MODEL_ID = "Lightricks/LTX-Video"
WAN_MODEL_ID = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
HUNYUAN_MODEL_ID = "hunyuanvideo-community/HunyuanVideo-I2V-33ch"
LTX_PREVIEW_MODEL_NAME = "ltx-video-i2v-preview"
LTX_PREVIEW_PRESET_ID = "preview_ltx_i2v"
WAN_STANDARD_MODEL_NAME = "wan2.2-ti2v-standard"
WAN_STANDARD_PRESET_ID = "standard_wan22_ti2v"
WAN_STANDARD_8S_PRESET_ID = "standard_wan22_ti2v_8s"
HUNYUAN_QUALITY_MODEL_NAME = "hunyuan-video-i2v-quality"
HUNYUAN_QUALITY_PRESET_ID = "quality_hunyuan_i2v"
LTX_TARGET_WIDTH = 832
LTX_TARGET_HEIGHT = 480
LTX_NUM_FRAMES = 121
LTX_NUM_INFERENCE_STEPS = 40
LTX_GUIDANCE_SCALE = 5.5
LTX_VIDEO_FPS = 24
# Tuned for L40S: keep 720p-ish quality while avoiding the long runtimes
# and timeout risk of the heavier 121-frame / 50-step configuration.
WAN_MAX_AREA = 480 * 832
WAN_NUM_FRAMES_5S = 81
WAN_NUM_FRAMES_8S = 121
WAN_NUM_INFERENCE_STEPS = 32
WAN_GUIDANCE_SCALE = 4.5
WAN_VIDEO_FPS = 24
HUNYUAN_LANDSCAPE_WIDTH = 960
HUNYUAN_LANDSCAPE_HEIGHT = 544
HUNYUAN_PORTRAIT_WIDTH = 544
HUNYUAN_PORTRAIT_HEIGHT = 960
HUNYUAN_NUM_FRAMES = 121
HUNYUAN_NUM_INFERENCE_STEPS = 24
HUNYUAN_GUIDANCE_SCALE = 6.0
HUNYUAN_VIDEO_FPS = 24
HUNYUAN_FLOW_SHIFT = 7.0
DEFAULT_NEGATIVE_PROMPT = (
    "worst quality, low quality, blurry, jittery, distorted, deformed, flicker"
)
MOTION_NEGATIVE_PROMPT = (
    "static frame, still image, frozen scene, no motion, almost no movement, "
    "broken motion, jumpy animation, inconsistent temporal motion"
)
MOTION_PROMPT_SUFFIX = (
    "The scene has clear visible motion and natural temporal progression. "
    "The subject moves in a believable way. "
    "The camera has gentle cinematic movement with subtle parallax. "
    "Motion is coherent across frames and the result should not look like a still image."
)
WAN_QUALITY_PROMPT_SUFFIX = (
    "Preserve the main subject identity, facial structure, clothing, and scene layout "
    "from the input image while creating premium cinematic image-to-video motion. "
    "Add rich natural movement, believable body mechanics, realistic physics, elegant "
    "camera motion, clean fine detail, stable anatomy, and strong temporal consistency."
)
WAN_T2V_PROMPT_SUFFIX = (
    "Generate a premium cinematic text-to-video shot with rich natural motion, "
    "believable body mechanics, realistic physics, stable anatomy, clean details, "
    "and strong temporal consistency from the first frame to the last."
)
WAN_NEGATIVE_PROMPT = (
    "low quality, blurry, static, frozen frame, weak motion, temporal flicker, "
    "jitter, warped anatomy, broken hands, distorted face, identity drift, subject "
    "duplication, morphing, melting details, unrealistic camera motion, background "
    "warping, overexposed highlights, watermark, text, subtitles, compression artifacts"
)
HUNYUAN_QUALITY_PROMPT_SUFFIX = (
    "Keep the first-frame identity and the original composition highly consistent. "
    "Generate a polished cinematic image-to-video shot with natural body motion, "
    "clean facial detail, stable anatomy, believable physics, and smooth camera movement. "
    "The motion should stay coherent from start to finish without abrupt scene drift."
)
HUNYUAN_NEGATIVE_PROMPT = (
    "low quality, blurry, oversharpened, frame flicker, temporal inconsistency, "
    "identity drift, broken anatomy, warped face, duplicated limbs, melting details, "
    "static frame, unnatural motion, camera shake, text, subtitles, watermark"
)


def _env_flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


WAN_USE_CPU_OFFLOAD = _env_flag("WAN_USE_CPU_OFFLOAD", False)
WAN_CPU_OFFLOAD_MODE = os.environ.get("WAN_CPU_OFFLOAD_MODE", "model").strip().lower()
WAN_ENABLE_ATTENTION_SLICING = _env_flag("WAN_ENABLE_ATTENTION_SLICING", False)
WAN_ENABLE_VAE_TILING = _env_flag("WAN_ENABLE_VAE_TILING", True)
WAN_ENABLE_VAE_SLICING = _env_flag("WAN_ENABLE_VAE_SLICING", True)

cache_volume = modal.Volume.from_name("neura-video-model-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install("fastapi[standard]", "pydantic>=2")
    .pip_install(
        "torch==2.6.0",
        "torchvision==0.21.0",
        "git+https://github.com/huggingface/diffusers.git@9d313fc718c8ace9a35f07dad9d5ce8018f8d216",
        "transformers==4.48.3",
        "accelerate>=1.1.0",
        "huggingface_hub==0.34.4",
        "imageio",
        "imageio-ffmpeg",
        "ftfy",
        "sentencepiece",
        "safetensors",
        "pillow",
        "requests",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .env(
        {
            "HF_HOME": MODEL_CACHE_DIR,
            "HF_HUB_CACHE": f"{MODEL_CACHE_DIR}/hub",
        }
    )
)

app = modal.App("neura-video-gen", image=image)

_LTX_PIPELINE = None
_WAN_T2V_PIPELINE = None
_WAN_I2V_PIPELINE = None
_HUNYUAN_PIPELINE = None


class GenReq(BaseModel):
    prompt: str
    job_id: str | None = Field(default=None, alias="jobId")
    negative_prompt: str | None = Field(default=None, alias="negativePrompt")
    input_image_url: str | None = Field(default=None, alias="inputImageUrl")
    provider: str | None = None
    model_name: str | None = Field(default=None, alias="modelName")
    preset_id: str | None = Field(default=None, alias="presetId")
    user_id: str | None = Field(default=None, alias="userId")
    workflow: str | None = None

    model_config = {"populate_by_name": True}


def _validate_preview_request(
    input_image_url: str | None,
    model_name: str | None,
    preset_id: str | None,
    workflow: str | None,
) -> None:
    if not input_image_url:
        raise ValueError("LTX preview requires inputImageUrl")

    if model_name and model_name != LTX_PREVIEW_MODEL_NAME:
        raise ValueError(
            f"Unsupported modelName for current Modal deployment: {model_name}"
        )

    if preset_id and preset_id != LTX_PREVIEW_PRESET_ID:
        raise ValueError(
            f"Unsupported presetId for current Modal deployment: {preset_id}"
        )

    if workflow and workflow != "I2V":
        raise ValueError(f"Unsupported workflow for current Modal deployment: {workflow}")


def _validate_wan_request(
    input_image_url: str | None,
    model_name: str | None,
    preset_id: str | None,
    workflow: str | None,
) -> None:
    if model_name and model_name != WAN_STANDARD_MODEL_NAME:
        raise ValueError(
            f"Unsupported modelName for Wan TI2V deployment: {model_name}"
        )

    allowed_preset_ids = {
        WAN_STANDARD_PRESET_ID,
        WAN_STANDARD_8S_PRESET_ID,
    }
    if preset_id and preset_id not in allowed_preset_ids:
        raise ValueError(
            f"Unsupported presetId for Wan TI2V deployment: {preset_id}"
        )

    if workflow and workflow not in {"TI2V", "I2V", "T2V"}:
        raise ValueError(f"Unsupported workflow for Wan TI2V deployment: {workflow}")


def _validate_hunyuan_request(
    input_image_url: str | None,
    model_name: str | None,
    preset_id: str | None,
    workflow: str | None,
) -> None:
    if not input_image_url:
        raise ValueError("Hunyuan I2V requires inputImageUrl")

    if model_name and model_name != HUNYUAN_QUALITY_MODEL_NAME:
        raise ValueError(
            f"Unsupported modelName for Hunyuan I2V deployment: {model_name}"
        )

    if preset_id and preset_id != HUNYUAN_QUALITY_PRESET_ID:
        raise ValueError(
            f"Unsupported presetId for Hunyuan I2V deployment: {preset_id}"
        )

    if workflow and workflow != "I2V":
        raise ValueError(f"Unsupported workflow for Hunyuan I2V deployment: {workflow}")


def _seed_from_job(job_id: str | None) -> int:
    if not job_id:
        return 42

    digest = hashlib.sha256(job_id.encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _build_prompt(prompt: str) -> str:
    return f"{prompt.strip()}. {MOTION_PROMPT_SUFFIX}"


def _build_negative_prompt(negative_prompt: str | None) -> str:
    parts = [DEFAULT_NEGATIVE_PROMPT, MOTION_NEGATIVE_PROMPT]
    if negative_prompt:
        parts.insert(0, negative_prompt.strip())

    return ", ".join(part for part in parts if part)


def _build_wan_prompt(prompt: str, has_input_image: bool) -> str:
    suffix = WAN_QUALITY_PROMPT_SUFFIX if has_input_image else WAN_T2V_PROMPT_SUFFIX
    return f"{prompt.strip()}. {suffix} The final clip should feel like a premium 24fps cinematic shot."


def _build_wan_negative_prompt(negative_prompt: str | None) -> str:
    parts = [WAN_NEGATIVE_PROMPT]
    if negative_prompt:
        parts.insert(0, negative_prompt.strip())

    return ", ".join(part for part in parts if part)


def _build_hunyuan_prompt(prompt: str) -> str:
    return f"{prompt.strip()}. {HUNYUAN_QUALITY_PROMPT_SUFFIX}"


def _build_hunyuan_negative_prompt(negative_prompt: str | None) -> str:
    parts = [HUNYUAN_NEGATIVE_PROMPT]
    if negative_prompt:
        parts.insert(0, negative_prompt.strip())

    return ", ".join(part for part in parts if part)


def _resolve_wan_profile(preset_id: str | None):
    resolved_preset_id = preset_id or WAN_STANDARD_PRESET_ID

    if resolved_preset_id == WAN_STANDARD_8S_PRESET_ID:
        return {
            "max_area": WAN_MAX_AREA,
            "num_frames": WAN_NUM_FRAMES_8S,
            "num_inference_steps": WAN_NUM_INFERENCE_STEPS,
            "guidance_scale": WAN_GUIDANCE_SCALE,
            "fps": WAN_VIDEO_FPS,
            "i2v_message": "Wan 2.2 TI2V standard (8s) generated successfully",
            "t2v_message": "Wan 2.2 T2V standard (8s) generated successfully",
            "preset_id": WAN_STANDARD_8S_PRESET_ID,
            "debug_version": "modal_wan22_ti2v_standard_v3_8s",
        }

    if resolved_preset_id == WAN_STANDARD_PRESET_ID:
        return {
            "max_area": WAN_MAX_AREA,
            "num_frames": WAN_NUM_FRAMES_5S,
            "num_inference_steps": WAN_NUM_INFERENCE_STEPS,
            "guidance_scale": WAN_GUIDANCE_SCALE,
            "fps": WAN_VIDEO_FPS,
            "i2v_message": "Wan 2.2 TI2V standard generated successfully",
            "t2v_message": "Wan 2.2 T2V standard generated successfully",
            "preset_id": WAN_STANDARD_PRESET_ID,
            "debug_version": "modal_wan22_ti2v_standard_v3_5s",
        }

    raise ValueError(f"Unsupported presetId for Wan TI2V deployment: {resolved_preset_id}")


def _resolve_hunyuan_profile():
    return {
        "num_frames": HUNYUAN_NUM_FRAMES,
        "num_inference_steps": HUNYUAN_NUM_INFERENCE_STEPS,
        "guidance_scale": HUNYUAN_GUIDANCE_SCALE,
        "fps": HUNYUAN_VIDEO_FPS,
        "flow_shift": HUNYUAN_FLOW_SHIFT,
        "message": "Hunyuan Video I2V quality generated successfully",
        "preset_id": HUNYUAN_QUALITY_PRESET_ID,
        "debug_version": "modal_hunyuan_i2v_quality_v3_5s",
    }


def _load_ltx_pipeline():
    global _LTX_PIPELINE

    if _LTX_PIPELINE is not None:
        return _LTX_PIPELINE

    import torch
    from diffusers import LTXImageToVideoPipeline

    pipe = LTXImageToVideoPipeline.from_pretrained(
        LTX_MODEL_ID,
        torch_dtype=torch.bfloat16,
    )
    pipe.to("cuda")

    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()
    elif hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
        pipe.vae.enable_tiling()

    _LTX_PIPELINE = pipe
    return _LTX_PIPELINE


def _load_wan_t2v_pipeline():
    global _WAN_T2V_PIPELINE

    if _WAN_T2V_PIPELINE is not None:
        return _WAN_T2V_PIPELINE

    _release_wan_i2v_pipeline()

    import torch
    from diffusers import AutoencoderKLWan, WanPipeline

    vae = AutoencoderKLWan.from_pretrained(
        WAN_MODEL_ID,
        subfolder="vae",
        torch_dtype=torch.float32,
    )
    pipe = WanPipeline.from_pretrained(
        WAN_MODEL_ID,
        vae=vae,
        torch_dtype=torch.bfloat16,
    )
    _configure_wan_pipeline_memory(pipe)

    _WAN_T2V_PIPELINE = pipe
    return _WAN_T2V_PIPELINE


def _load_wan_i2v_pipeline():
    global _WAN_I2V_PIPELINE

    if _WAN_I2V_PIPELINE is not None:
        return _WAN_I2V_PIPELINE

    _release_wan_t2v_pipeline()

    import torch
    from diffusers import AutoencoderKLWan, WanImageToVideoPipeline

    vae = AutoencoderKLWan.from_pretrained(
        WAN_MODEL_ID,
        subfolder="vae",
        torch_dtype=torch.float32,
    )
    pipe = WanImageToVideoPipeline.from_pretrained(
        WAN_MODEL_ID,
        vae=vae,
        torch_dtype=torch.bfloat16,
    )
    _configure_wan_pipeline_memory(pipe)

    _WAN_I2V_PIPELINE = pipe
    return _WAN_I2V_PIPELINE


def _configure_wan_pipeline_memory(pipe):
    # Keep generation quality/profile unchanged; only tune memory behavior.
    if WAN_ENABLE_VAE_TILING:
        if hasattr(pipe, "enable_vae_tiling"):
            pipe.enable_vae_tiling()
        elif hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
            pipe.vae.enable_tiling()

    if WAN_ENABLE_VAE_SLICING:
        if hasattr(pipe, "enable_vae_slicing"):
            pipe.enable_vae_slicing()
        elif hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_slicing"):
            pipe.vae.enable_slicing()

    if WAN_ENABLE_ATTENTION_SLICING and hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing("max")

    if WAN_USE_CPU_OFFLOAD:
        if WAN_CPU_OFFLOAD_MODE == "sequential" and hasattr(
            pipe,
            "enable_sequential_cpu_offload",
        ):
            pipe.enable_sequential_cpu_offload()
            return

        if hasattr(pipe, "enable_model_cpu_offload"):
            pipe.enable_model_cpu_offload()
            return

    pipe.to("cuda")


def _release_wan_t2v_pipeline():
    global _WAN_T2V_PIPELINE
    if _WAN_T2V_PIPELINE is None:
        return

    _WAN_T2V_PIPELINE = None
    _cleanup_cuda_memory()


def _release_wan_i2v_pipeline():
    global _WAN_I2V_PIPELINE
    if _WAN_I2V_PIPELINE is None:
        return

    _WAN_I2V_PIPELINE = None
    _cleanup_cuda_memory()


def _cleanup_cuda_memory():
    import gc

    gc.collect()

    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        # Best-effort cleanup only; don't block inference if torch cleanup fails.
        pass


def _load_hunyuan_pipeline():
    global _HUNYUAN_PIPELINE

    if _HUNYUAN_PIPELINE is not None:
        return _HUNYUAN_PIPELINE

    import torch
    from diffusers import (
        FlowMatchEulerDiscreteScheduler,
        HunyuanVideoImageToVideoPipeline,
    )

    pipe = HunyuanVideoImageToVideoPipeline.from_pretrained(
        HUNYUAN_MODEL_ID,
        torch_dtype=torch.bfloat16,
    )

    if pipe.scheduler is not None:
        pipe.scheduler = FlowMatchEulerDiscreteScheduler.from_config(
            pipe.scheduler.config,
            shift=HUNYUAN_FLOW_SHIFT,
        )

    if hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
        pipe.vae.enable_tiling()
    if hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_slicing"):
        pipe.vae.enable_slicing()

    pipe.to("cuda")

    _HUNYUAN_PIPELINE = pipe
    return _HUNYUAN_PIPELINE


def _load_input_image(image_url: str):
    import requests
    from PIL import Image, ImageOps

    response = requests.get(image_url, timeout=60)
    response.raise_for_status()

    image = Image.open(BytesIO(response.content))
    image = image.convert("RGB")
    return ImageOps.fit(
        image,
        (LTX_TARGET_WIDTH, LTX_TARGET_HEIGHT),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )


def _load_wan_input_image(image_url: str, pipe, max_area: int):
    import numpy as np
    import requests
    from PIL import Image

    response = requests.get(image_url, timeout=60)
    response.raise_for_status()

    image = Image.open(BytesIO(response.content)).convert("RGB")

    aspect_ratio = image.height / image.width
    mod_value = pipe.vae_scale_factor_spatial * pipe.transformer.config.patch_size[1]
    height = max(
        mod_value,
        round(np.sqrt(max_area * aspect_ratio)) // mod_value * mod_value,
    )
    width = max(
        mod_value,
        round(np.sqrt(max_area / aspect_ratio)) // mod_value * mod_value,
    )

    resized = image.resize((width, height), Image.Resampling.LANCZOS)
    return resized, height, width


def _resolve_wan_text_dimensions(pipe, max_area: int):
    import numpy as np

    # Default to a 16:9 landscape canvas for text-only generation.
    aspect_ratio = 9 / 16
    mod_value = pipe.vae_scale_factor_spatial * pipe.transformer.config.patch_size[1]

    height = max(
        mod_value,
        round(np.sqrt(max_area * aspect_ratio)) // mod_value * mod_value,
    )
    width = max(
        mod_value,
        round(np.sqrt(max_area / aspect_ratio)) // mod_value * mod_value,
    )
    return height, width


def _load_hunyuan_input_image(image_url: str):
    import requests
    from PIL import Image, ImageOps

    response = requests.get(image_url, timeout=60)
    response.raise_for_status()

    image = Image.open(BytesIO(response.content)).convert("RGB")
    target_size = (
        (HUNYUAN_LANDSCAPE_WIDTH, HUNYUAN_LANDSCAPE_HEIGHT)
        if image.width >= image.height
        else (HUNYUAN_PORTRAIT_WIDTH, HUNYUAN_PORTRAIT_HEIGHT)
    )

    fitted = ImageOps.fit(
        image,
        target_size,
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    return fitted, target_size[1], target_size[0]


@app.function(
    gpu="L4",
    timeout=60 * 30,
    scaledown_window=10 * 60,
    volumes={MODEL_CACHE_DIR: cache_volume},
)
def generate_video_core(
    prompt: str,
    job_id: str | None = None,
    negative_prompt: str | None = None,
    input_image_url: str | None = None,
    provider: str | None = None,
    model_name: str | None = None,
    preset_id: str | None = None,
    user_id: str | None = None,
    workflow: str | None = None,
):
    return _generate_video_response(
        prompt=prompt,
        job_id=job_id,
        negative_prompt=negative_prompt,
        input_image_url=input_image_url,
        provider=provider,
        model_name=model_name,
        preset_id=preset_id,
        user_id=user_id,
        workflow=workflow,
    )


def _generate_video_response(
    prompt: str,
    job_id: str | None = None,
    negative_prompt: str | None = None,
    input_image_url: str | None = None,
    provider: str | None = None,
    model_name: str | None = None,
    preset_id: str | None = None,
    user_id: str | None = None,
    workflow: str | None = None,
):
    import torch
    from diffusers.utils import export_to_video

    _validate_preview_request(input_image_url, model_name, preset_id, workflow)

    pipe = _load_ltx_pipeline()
    image = _load_input_image(input_image_url)
    generator = torch.Generator(device="cuda").manual_seed(_seed_from_job(job_id))

    result = pipe(
        image=image,
        prompt=_build_prompt(prompt),
        negative_prompt=_build_negative_prompt(negative_prompt),
        width=LTX_TARGET_WIDTH,
        height=LTX_TARGET_HEIGHT,
        num_frames=LTX_NUM_FRAMES,
        num_inference_steps=LTX_NUM_INFERENCE_STEPS,
        decode_timestep=0.05,
        decode_noise_scale=0.05,
        guidance_scale=LTX_GUIDANCE_SCALE,
        generator=generator,
    )
    frames = result.frames[0]

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        output_path = tmp.name

    try:
        export_to_video(frames, output_path, fps=LTX_VIDEO_FPS)
        with open(output_path, "rb") as video_file:
            encoded_video = base64.b64encode(video_file.read()).decode("utf-8")
    finally:
        if os.path.exists(output_path):
            os.remove(output_path)

    return {
        "status": "ok",
        "message": "LTX preview generated successfully",
        "job_id": job_id,
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "input_image_url": input_image_url,
        "provider": provider or "modal",
        "model_name": model_name or LTX_PREVIEW_MODEL_NAME,
        "preset_id": preset_id or LTX_PREVIEW_PRESET_ID,
        "user_id": user_id,
        "workflow": workflow or "I2V",
        "video_base64": encoded_video,
        "generation_config": {
            "width": LTX_TARGET_WIDTH,
            "height": LTX_TARGET_HEIGHT,
            "num_frames": LTX_NUM_FRAMES,
            "num_inference_steps": LTX_NUM_INFERENCE_STEPS,
            "guidance_scale": LTX_GUIDANCE_SCALE,
            "fps": LTX_VIDEO_FPS,
        },
        "debug_version": "modal_ltx_preview_v1",
    }


@app.function(
    gpu="L4",
    timeout=60 * 30,
    scaledown_window=10 * 60,
    volumes={MODEL_CACHE_DIR: cache_volume},
)
@modal.fastapi_endpoint(method="POST")
def generate_video(req: dict):
    data = GenReq.model_validate(req)

    return _generate_video_response(
        prompt=data.prompt,
        job_id=data.job_id,
        negative_prompt=data.negative_prompt,
        input_image_url=data.input_image_url,
        provider=data.provider,
        model_name=data.model_name,
        preset_id=data.preset_id,
        user_id=data.user_id,
        workflow=data.workflow,
    )


@app.function(
    gpu="L40S",
    timeout=60 * 60,
    scaledown_window=10 * 60,
    volumes={MODEL_CACHE_DIR: cache_volume},
)
def generate_wan_video_core(
    prompt: str,
    job_id: str | None = None,
    negative_prompt: str | None = None,
    input_image_url: str | None = None,
    provider: str | None = None,
    model_name: str | None = None,
    preset_id: str | None = None,
    user_id: str | None = None,
    workflow: str | None = None,
):
    return _generate_wan_video_response(
        prompt=prompt,
        job_id=job_id,
        negative_prompt=negative_prompt,
        input_image_url=input_image_url,
        provider=provider,
        model_name=model_name,
        preset_id=preset_id,
        user_id=user_id,
        workflow=workflow,
    )


@app.function(
    gpu="A100-80GB",
    timeout=60 * 60,
    scaledown_window=10 * 60,
    volumes={MODEL_CACHE_DIR: cache_volume},
)
def generate_hunyuan_video_core(
    prompt: str,
    job_id: str | None = None,
    negative_prompt: str | None = None,
    input_image_url: str | None = None,
    provider: str | None = None,
    model_name: str | None = None,
    preset_id: str | None = None,
    user_id: str | None = None,
    workflow: str | None = None,
):
    return _generate_hunyuan_video_response(
        prompt=prompt,
        job_id=job_id,
        negative_prompt=negative_prompt,
        input_image_url=input_image_url,
        provider=provider,
        model_name=model_name,
        preset_id=preset_id,
        user_id=user_id,
        workflow=workflow,
    )


def _generate_wan_video_response(
    prompt: str,
    job_id: str | None = None,
    negative_prompt: str | None = None,
    input_image_url: str | None = None,
    provider: str | None = None,
    model_name: str | None = None,
    preset_id: str | None = None,
    user_id: str | None = None,
    workflow: str | None = None,
):
    import torch
    from diffusers.utils import export_to_video

    _validate_wan_request(input_image_url, model_name, preset_id, workflow)

    profile = _resolve_wan_profile(preset_id)
    has_input_image = bool(input_image_url)
    image = None
    if has_input_image:
        pipe = _load_wan_i2v_pipeline()
        image, height, width = _load_wan_input_image(
            input_image_url,
            pipe,
            profile["max_area"],
        )
    else:
        pipe = _load_wan_t2v_pipeline()
        height, width = _resolve_wan_text_dimensions(pipe, profile["max_area"])

    generator = torch.Generator(device="cpu").manual_seed(_seed_from_job(job_id))

    generation_kwargs = {
        "prompt": _build_wan_prompt(prompt, has_input_image),
        "negative_prompt": _build_wan_negative_prompt(negative_prompt),
        "height": height,
        "width": width,
        "num_frames": profile["num_frames"],
        "num_inference_steps": profile["num_inference_steps"],
        "guidance_scale": profile["guidance_scale"],
        "generator": generator,
    }
    if has_input_image:
        generation_kwargs["image"] = image

    _cleanup_cuda_memory()
    result = pipe(
        **generation_kwargs,
    )
    frames = result.frames[0]

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        output_path = tmp.name

    try:
        export_to_video(frames, output_path, fps=profile["fps"])
        with open(output_path, "rb") as video_file:
            encoded_video = base64.b64encode(video_file.read()).decode("utf-8")
    finally:
        if os.path.exists(output_path):
            os.remove(output_path)

    resolved_workflow = "I2V" if has_input_image else "T2V"
    return {
        "status": "ok",
        "message": profile["i2v_message"] if has_input_image else profile["t2v_message"],
        "job_id": job_id,
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "input_image_url": input_image_url,
        "provider": provider or "modal",
        "model_name": model_name or WAN_STANDARD_MODEL_NAME,
        "preset_id": preset_id or profile["preset_id"],
        "user_id": user_id,
        "workflow": resolved_workflow,
        "video_base64": encoded_video,
        "generation_config": {
            "width": width,
            "height": height,
            "num_frames": profile["num_frames"],
            "num_inference_steps": profile["num_inference_steps"],
            "guidance_scale": profile["guidance_scale"],
            "fps": profile["fps"],
            "input_mode": "image" if has_input_image else "text",
        },
        "debug_version": profile["debug_version"],
    }


def _generate_hunyuan_video_response(
    prompt: str,
    job_id: str | None = None,
    negative_prompt: str | None = None,
    input_image_url: str | None = None,
    provider: str | None = None,
    model_name: str | None = None,
    preset_id: str | None = None,
    user_id: str | None = None,
    workflow: str | None = None,
):
    import torch
    from diffusers.utils import export_to_video

    _validate_hunyuan_request(input_image_url, model_name, preset_id, workflow)

    profile = _resolve_hunyuan_profile()
    pipe = _load_hunyuan_pipeline()
    image, height, width = _load_hunyuan_input_image(input_image_url)
    generator = torch.Generator(device="cuda").manual_seed(_seed_from_job(job_id))

    result = pipe(
        prompt=_build_hunyuan_prompt(prompt),
        negative_prompt=_build_hunyuan_negative_prompt(negative_prompt),
        image=image,
        height=height,
        width=width,
        num_frames=profile["num_frames"],
        num_inference_steps=profile["num_inference_steps"],
        guidance_scale=profile["guidance_scale"],
        generator=generator,
    )
    frames = result.frames[0]

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        output_path = tmp.name

    try:
        export_to_video(frames, output_path, fps=profile["fps"])
        with open(output_path, "rb") as video_file:
            encoded_video = base64.b64encode(video_file.read()).decode("utf-8")
    finally:
        if os.path.exists(output_path):
            os.remove(output_path)

    return {
        "status": "ok",
        "message": profile["message"],
        "job_id": job_id,
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "input_image_url": input_image_url,
        "provider": provider or "modal",
        "model_name": model_name or HUNYUAN_QUALITY_MODEL_NAME,
        "preset_id": preset_id or profile["preset_id"],
        "user_id": user_id,
        "workflow": workflow or "I2V",
        "video_base64": encoded_video,
        "generation_config": {
            "width": width,
            "height": height,
            "num_frames": profile["num_frames"],
            "num_inference_steps": profile["num_inference_steps"],
            "guidance_scale": profile["guidance_scale"],
            "fps": profile["fps"],
            "flow_shift": profile["flow_shift"],
        },
        "debug_version": profile["debug_version"],
    }


@app.function(
    gpu="L40S",
    timeout=60 * 60,
    scaledown_window=10 * 60,
    volumes={MODEL_CACHE_DIR: cache_volume},
)
@modal.fastapi_endpoint(method="POST")
def generate_video_wan(req: dict):
    data = GenReq.model_validate(req)

    return _generate_wan_video_response(
        prompt=data.prompt,
        job_id=data.job_id,
        negative_prompt=data.negative_prompt,
        input_image_url=data.input_image_url,
        provider=data.provider,
        model_name=data.model_name,
        preset_id=data.preset_id,
        user_id=data.user_id,
        workflow=data.workflow,
    )


@app.function(
    gpu="A100-80GB",
    timeout=60 * 60,
    scaledown_window=10 * 60,
    volumes={MODEL_CACHE_DIR: cache_volume},
)
@modal.fastapi_endpoint(method="POST")
def generate_video_hunyuan(req: dict):
    data = GenReq.model_validate(req)

    return _generate_hunyuan_video_response(
        prompt=data.prompt,
        job_id=data.job_id,
        negative_prompt=data.negative_prompt,
        input_image_url=data.input_image_url,
        provider=data.provider,
        model_name=data.model_name,
        preset_id=data.preset_id,
        user_id=data.user_id,
        workflow=data.workflow,
    )
