import modal
from pydantic import BaseModel

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]", "pydantic>=2")
)

app = modal.App("neura-video-gen", image=image)


class GenReq(BaseModel):
    prompt: str
    user_id: str | None = None


@app.function()
def generate_video_core(prompt: str, user_id: str | None = None):
    # TODO: gọi pipeline thật của bạn
    return {
        "status": "ok",
        "message": "Modal core ran successfully",
        "prompt": prompt,
        "user_id": user_id,
    }


@app.function()
@modal.fastapi_endpoint(method="POST")
def generate_video(req: dict):
    """
    Nhận JSON body dạng dict
    Validate bằng Pydantic v2
    """
    data = GenReq.model_validate(req)
    return generate_video_core.remote(data.prompt, data.user_id)
