import base64
import hashlib
import os
import tempfile
from io import BytesIO

import modal
from pydantic import BaseModel, Field

MODEL_CACHE_DIR = "/cache"
MODEL_ID = "Lightricks/LTX-Video"
LTX_PREVIEW_MODEL_NAME = "ltx-video-i2v-preview"
LTX_PREVIEW_PRESET_ID = "preview_ltx_i2v"
DEFAULT_NEGATIVE_PROMPT = (
    "worst quality, low quality, blurry, jittery, distorted, deformed, flicker"
)

cache_volume = modal.Volume.from_name("neura-video-model-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("fastapi[standard]", "pydantic>=2")
    .pip_install(
        "torch==2.6.0",
        "torchvision==0.21.0",
        "diffusers==0.35.2",
        "transformers==4.48.3",
        "accelerate>=1.1.0",
        "huggingface_hub==0.34.4",
        "imageio",
        "imageio-ffmpeg",
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

_PIPELINE = None


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


def _seed_from_job(job_id: str | None) -> int:
    if not job_id:
        return 42

    digest = hashlib.sha256(job_id.encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _load_pipeline():
    global _PIPELINE

    if _PIPELINE is not None:
        return _PIPELINE

    import torch
    from diffusers import LTXImageToVideoPipeline

    pipe = LTXImageToVideoPipeline.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.bfloat16,
    )
    pipe.to("cuda")

    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()
    elif hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
        pipe.vae.enable_tiling()

    _PIPELINE = pipe
    return _PIPELINE


def _load_input_image(image_url: str):
    import requests
    from PIL import Image

    response = requests.get(image_url, timeout=60)
    response.raise_for_status()

    image = Image.open(BytesIO(response.content))
    return image.convert("RGB")


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
    import torch
    from diffusers.utils import export_to_video

    _validate_preview_request(input_image_url, model_name, preset_id, workflow)

    pipe = _load_pipeline()
    image = _load_input_image(input_image_url)
    generator = torch.Generator(device="cuda").manual_seed(_seed_from_job(job_id))

    result = pipe(
        image=image,
        prompt=prompt,
        negative_prompt=negative_prompt or DEFAULT_NEGATIVE_PROMPT,
        width=704,
        height=480,
        num_frames=81,
        num_inference_steps=30,
        decode_timestep=0.05,
        decode_noise_scale=0.025,
        guidance_scale=3.0,
        generator=generator,
    )
    frames = result.frames[0]

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        output_path = tmp.name

    try:
        export_to_video(frames, output_path, fps=16)
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
        "debug_version": "modal_ltx_preview_v1",
    }


@app.function()
@modal.fastapi_endpoint(method="POST")
def generate_video(req: dict):
    data = GenReq.model_validate(req)

    return generate_video_core.remote(
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
