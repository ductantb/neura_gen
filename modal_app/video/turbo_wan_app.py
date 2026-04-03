import base64
import hashlib
import os
import subprocess
import tempfile
import time

import modal
from pydantic import BaseModel, Field

MODEL_CACHE_DIR = "/cache"
TURBO_REPO_DIR = "/opt/TurboDiffusion"
TURBO_CHECKPOINT_DIR = f"{MODEL_CACHE_DIR}/turbodiffusion/checkpoints"
TURBO_OUTPUT_FPS = 16
TURBO_NUM_FRAMES = 81
TURBO_NUM_STEPS = 4
TURBO_RESOLUTION = "720p"
TURBO_ASPECT_RATIO = "16:9"
SUPPORTED_ATTENTION_TYPES = {"original", "sla", "sagesla"}
TURBO_SLA_TOPK = "0.15"
TURBO_BOUNDARY = "0.9"
TURBO_SIGMA_MAX = "200"
TURBO_MODEL_NAME = "wan2.2-i2v-a14b-turbo"
TURBO_PRESET_ID = "turbo_wan22_i2v_a14b"
TURBO_HIGH_REPO = "TurboDiffusion/TurboWan2.2-I2V-A14B-720P"
TURBO_LOW_REPO = "TurboDiffusion/TurboWan2.2-I2V-A14B-720P"
WAN_AUX_REPO = "Wan-AI/Wan2.1-T2V-1.3B"
WAN_VAE_FILE = "Wan2.1_VAE.pth"
WAN_TEXT_ENCODER_FILE = "models_t5_umt5-xxl-enc-bf16.pth"
TURBO_PROMPT_SUFFIX = (
    "Preserve the input subject identity and composition while generating vivid, "
    "coherent motion with premium cinematic feel. Keep motion energetic but stable."
)


def _env_flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


TURBO_ATTENTION_TYPE = os.environ.get("TURBO_WAN_ATTENTION_TYPE", "original").strip().lower()
TURBO_USE_QUANTIZED_CHECKPOINTS = _env_flag(
    "TURBO_WAN_USE_QUANTIZED_CHECKPOINTS",
    False,
)
TURBO_USE_ODE = _env_flag("TURBO_WAN_USE_ODE", False)
TURBO_CHECKPOINT_VARIANT = "quantized" if TURBO_USE_QUANTIZED_CHECKPOINTS else "full"

if TURBO_USE_QUANTIZED_CHECKPOINTS:
    TURBO_HIGH_FILES = (
        "TurboWan2.2-I2V-A14B-high-720P-quant.pth",
        "TurboDiffusion-Wan2.2-I2V-A14B-high-720P-quant.pth",
    )
    TURBO_LOW_FILES = (
        "TurboWan2.2-I2V-A14B-low-720P-quant.pth",
        "TurboDiffusion-Wan2.2-I2V-A14B-low-720P-quant.pth",
    )
else:
    TURBO_HIGH_FILES = (
        "TurboWan2.2-I2V-A14B-high-720P.pth",
        "TurboDiffusion-Wan2.2-I2V-A14B-high-720P.pth",
    )
    TURBO_LOW_FILES = (
        "TurboWan2.2-I2V-A14B-low-720P.pth",
        "TurboDiffusion-Wan2.2-I2V-A14B-low-720P.pth",
    )

cache_volume = modal.Volume.from_name("neura-video-model-cache", create_if_missing=True)

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.8.1-cudnn-devel-ubuntu22.04",
        add_python="3.12",
    )
    .apt_install("ffmpeg", "git", "build-essential", "clang")
    .pip_install("fastapi[standard]", "pydantic>=2")
    .pip_install(
        "torch==2.8.0",
        "torchvision",
        "einops",
        "tqdm",
        "numpy",
        "pillow",
        "imageio",
        "imageio-ffmpeg",
        "loguru",
        "pandas",
        "PyYAML",
        "omegaconf",
        "attrs",
        "fvcore",
        "ftfy",
        "regex",
        "transformers",
        "nvidia-ml-py",
        "ninja",
        "packaging>=21",
        "prompt-toolkit>=3.0",
        "rich>=13.0",
        "setuptools>=70.1",
        "triton>=3.3.0",
        "wheel>=0.38",
        "huggingface_hub",
        "requests",
        extra_index_url="https://download.pytorch.org/whl/cu128",
    )
    .run_commands(
        "git clone --depth 1 https://github.com/thu-ml/TurboDiffusion.git /opt/TurboDiffusion",
        "cd /opt/TurboDiffusion && git submodule update --init --recursive",
        "cd /opt/TurboDiffusion && pip install -e . --no-build-isolation",
    )
    .env(
        {
            "CUDA_HOME": "/usr/local/cuda",
            "HF_HOME": MODEL_CACHE_DIR,
            "HF_HUB_CACHE": f"{MODEL_CACHE_DIR}/hub",
            "TOKENIZERS_PARALLELISM": "false",
        }
    )
)

app = modal.App("neura-video-gen-turbo-wan", image=image)


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


def _seed_from_job(job_id: str | None) -> int:
    if not job_id:
        return 42

    digest = hashlib.sha256(job_id.encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _validate_request(
    input_image_url: str | None,
    model_name: str | None,
    preset_id: str | None,
    workflow: str | None,
) -> None:
    if not input_image_url:
        raise ValueError("Turbo Wan requires inputImageUrl")

    if model_name and model_name != TURBO_MODEL_NAME:
        raise ValueError(
            f"Unsupported modelName for Turbo Wan deployment: {model_name}"
        )

    if preset_id and preset_id != TURBO_PRESET_ID:
        raise ValueError(
            f"Unsupported presetId for Turbo Wan deployment: {preset_id}"
        )

    if workflow and workflow != "I2V":
        raise ValueError(f"Unsupported workflow for Turbo Wan deployment: {workflow}")


def _build_prompt(prompt: str) -> str:
    return f"{prompt.strip()}. {TURBO_PROMPT_SUFFIX}"


def _ensure_checkpoint(repo_id: str, filename: str) -> str:
    from huggingface_hub import hf_hub_download

    return hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=TURBO_CHECKPOINT_DIR,
    )


def _ensure_checkpoint_from_candidates(
    repo_id: str,
    filenames: tuple[str, ...],
) -> str:
    last_error = None

    for filename in filenames:
        try:
            return _ensure_checkpoint(repo_id, filename)
        except Exception as error:  # noqa: BLE001
            last_error = error

    candidate_list = ", ".join(filenames)
    raise RuntimeError(
        f"Unable to download any checkpoint variant from {repo_id}: {candidate_list}"
    ) from last_error


def _ensure_runtime_assets():
    os.makedirs(TURBO_CHECKPOINT_DIR, exist_ok=True)

    return {
        "high_noise_model_path": _ensure_checkpoint_from_candidates(
            TURBO_HIGH_REPO,
            TURBO_HIGH_FILES,
        ),
        "low_noise_model_path": _ensure_checkpoint_from_candidates(
            TURBO_LOW_REPO,
            TURBO_LOW_FILES,
        ),
        "vae_path": _ensure_checkpoint(WAN_AUX_REPO, WAN_VAE_FILE),
        "text_encoder_path": _ensure_checkpoint(WAN_AUX_REPO, WAN_TEXT_ENCODER_FILE),
    }


def _download_input_image(image_url: str) -> str:
    import requests

    response = requests.get(image_url, timeout=60)
    response.raise_for_status()

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(response.content)
        return tmp.name


def _run_turbo_inference(
    prompt: str,
    input_image_path: str,
    save_path: str,
    seed: int,
    checkpoint_paths: dict[str, str],
):
    if TURBO_ATTENTION_TYPE not in SUPPORTED_ATTENTION_TYPES:
        supported = ", ".join(sorted(SUPPORTED_ATTENTION_TYPES))
        raise ValueError(
            f"Unsupported TURBO_WAN_ATTENTION_TYPE={TURBO_ATTENTION_TYPE!r}. "
            f"Expected one of: {supported}"
        )

    command = [
        "python",
        f"{TURBO_REPO_DIR}/turbodiffusion/inference/wan2.2_i2v_infer.py",
        "--model",
        "Wan2.2-A14B",
        "--high_noise_model_path",
        checkpoint_paths["high_noise_model_path"],
        "--low_noise_model_path",
        checkpoint_paths["low_noise_model_path"],
        "--vae_path",
        checkpoint_paths["vae_path"],
        "--text_encoder_path",
        checkpoint_paths["text_encoder_path"],
        "--resolution",
        TURBO_RESOLUTION,
        "--aspect_ratio",
        TURBO_ASPECT_RATIO,
        "--adaptive_resolution",
        "--image_path",
        input_image_path,
        "--prompt",
        prompt,
        "--num_samples",
        "1",
        "--num_steps",
        str(TURBO_NUM_STEPS),
        "--num_frames",
        str(TURBO_NUM_FRAMES),
        "--seed",
        str(seed),
        "--save_path",
        save_path,
        "--boundary",
        TURBO_BOUNDARY,
        "--sigma_max",
        TURBO_SIGMA_MAX,
        "--attention_type",
        TURBO_ATTENTION_TYPE,
        "--sla_topk",
        TURBO_SLA_TOPK,
    ]

    if TURBO_USE_QUANTIZED_CHECKPOINTS:
        command.append("--quant_linear")

    if TURBO_USE_ODE:
        command.append("--ode")

    environment = os.environ.copy()
    environment["PYTHONPATH"] = f"{TURBO_REPO_DIR}/turbodiffusion"
    environment["TOKENIZERS_PARALLELISM"] = "false"

    completed = subprocess.run(
        command,
        cwd=TURBO_REPO_DIR,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )

    if completed.returncode != 0:
        tail = completed.stdout[-6000:]
        raise RuntimeError(f"Turbo Wan inference failed:\n{tail}")


def _generate_response(
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
    started_at = time.monotonic()
    _validate_request(input_image_url, model_name, preset_id, workflow)

    asset_started_at = time.monotonic()
    checkpoint_paths = _ensure_runtime_assets()
    asset_download_seconds = time.monotonic() - asset_started_at
    input_image_path = _download_input_image(input_image_url)

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        output_path = tmp.name

    try:
        inference_started_at = time.monotonic()
        _run_turbo_inference(
            prompt=_build_prompt(prompt),
            input_image_path=input_image_path,
            save_path=output_path,
            seed=_seed_from_job(job_id),
            checkpoint_paths=checkpoint_paths,
        )
        inference_seconds = time.monotonic() - inference_started_at

        with open(output_path, "rb") as video_file:
            encoded_video = base64.b64encode(video_file.read()).decode("utf-8")
    finally:
        if os.path.exists(input_image_path):
            os.remove(input_image_path)
        if os.path.exists(output_path):
            os.remove(output_path)

    elapsed_seconds = time.monotonic() - started_at

    return {
        "status": "ok",
        "message": "Turbo Wan 2.2 I2V generated successfully",
        "job_id": job_id,
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "input_image_url": input_image_url,
        "provider": provider or "modal",
        "model_name": model_name or TURBO_MODEL_NAME,
        "preset_id": preset_id or TURBO_PRESET_ID,
        "user_id": user_id,
        "workflow": workflow or "I2V",
        "video_base64": encoded_video,
        "generation_config": {
            "resolution": TURBO_RESOLUTION,
            "aspect_ratio": TURBO_ASPECT_RATIO,
            "num_frames": TURBO_NUM_FRAMES,
            "num_inference_steps": TURBO_NUM_STEPS,
            "fps": TURBO_OUTPUT_FPS,
            "attention_type": TURBO_ATTENTION_TYPE,
            "boundary": float(TURBO_BOUNDARY),
            "sigma_max": float(TURBO_SIGMA_MAX),
            "checkpoint_variant": TURBO_CHECKPOINT_VARIANT,
            "uses_ode": TURBO_USE_ODE,
            "uses_quantized_checkpoints": TURBO_USE_QUANTIZED_CHECKPOINTS,
            "uses_negative_prompt": False,
        },
        "asset_download_seconds": round(asset_download_seconds, 2),
        "inference_seconds": round(inference_seconds, 2),
        "elapsed_seconds": round(elapsed_seconds, 2),
        "debug_version": "modal_turbo_wan22_i2v_a14b_v2",
    }


@app.function(
    gpu="A100-80GB",
    timeout=60 * 30,
    scaledown_window=10 * 60,
    volumes={MODEL_CACHE_DIR: cache_volume},
)
def generate_turbo_video_core(
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
    return _generate_response(
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
    timeout=60 * 30,
    scaledown_window=10 * 60,
    volumes={MODEL_CACHE_DIR: cache_volume},
)
@modal.fastapi_endpoint(method="POST")
def generate_video(req: dict):
    data = GenReq.model_validate(req)

    return _generate_response(
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
