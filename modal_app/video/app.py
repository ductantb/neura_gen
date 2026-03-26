import modal
from pydantic import BaseModel, Field

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]", "pydantic>=2")
)

app = modal.App("neura-video-gen", image=image)


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

    model_config = {
        "populate_by_name": True
    }


@app.function()
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
    # TODO: thay bằng pipeline AI thật
    # Tạm thời trả về video_url giả để test contract
    return {
        "status": "ok",
        "message": "Modal core ran successfully",
        "job_id": job_id,
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "input_image_url": input_image_url,
        "provider": provider,
        "model_name": model_name,
        "preset_id": preset_id,
        "user_id": user_id,
        "workflow": workflow,
        "video_url": "https://samplelib.com/lib/preview/mp4/sample-5s.mp4",
        "debug_version": "modal_v2_20260321_a",
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
