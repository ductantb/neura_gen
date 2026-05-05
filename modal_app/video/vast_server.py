from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from app import (
    GenReq,
    HUNYUAN_QUALITY_MODEL_NAME,
    HUNYUAN_QUALITY_PRESET_ID,
    LTX_PREVIEW_MODEL_NAME,
    LTX_PREVIEW_PRESET_ID,
    WAN_STANDARD_8S_PRESET_ID,
    WAN_STANDARD_MODEL_NAME,
    WAN_STANDARD_PRESET_ID,
    _generate_hunyuan_video_response,
    _generate_video_response,
    _generate_wan_video_response,
)

app = FastAPI(title='NeuraGen Vast Video Server', version='1.1.0')
TURBO_WAN_MODEL_NAME = 'wan2.2-i2v-a14b-turbo'
TURBO_WAN_PRESET_ID = 'turbo_wan22_i2v_a14b'


def _raise_turbo_not_supported(*_args, **_kwargs):
    raise ValueError(
        'Turbo Wan is not bundled in this Vast standard image. '
        'Use Modal fallback or a dedicated Vast turbo image.'
    )


def _resolve_target_handler(model_name: str | None, preset_id: str | None):
    if model_name == TURBO_WAN_MODEL_NAME or preset_id == TURBO_WAN_PRESET_ID:
        return _raise_turbo_not_supported

    if model_name == LTX_PREVIEW_MODEL_NAME or preset_id == LTX_PREVIEW_PRESET_ID:
        return _generate_video_response

    if model_name == HUNYUAN_QUALITY_MODEL_NAME or preset_id == HUNYUAN_QUALITY_PRESET_ID:
        return _generate_hunyuan_video_response

    if model_name == WAN_STANDARD_MODEL_NAME or preset_id in {
        WAN_STANDARD_PRESET_ID,
        WAN_STANDARD_8S_PRESET_ID,
    }:
        return _generate_wan_video_response

    # Default to WAN path because current product default is standard_wan22_ti2v.
    return _generate_wan_video_response


@app.get('/health')
def healthcheck():
    return {'status': 'ok', 'service': 'vast-video-multi-model'}


@app.post('/invoke')
def invoke(req: dict):
    try:
        data = GenReq.model_validate(req)
        handler = _resolve_target_handler(data.model_name, data.preset_id)
        response = handler(
            prompt=data.prompt,
            job_id=data.job_id,
            negative_prompt=data.negative_prompt,
            input_image_url=data.input_image_url,
            provider='vast',
            model_name=data.model_name,
            preset_id=data.preset_id,
            user_id=data.user_id,
            workflow=data.workflow,
        )
        # Force provider field so backend logs/provider routing stay consistent.
        response['provider'] = 'vast'
        return response
    except ValidationError as error:
        raise HTTPException(status_code=400, detail=error.errors()) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:  # pragma: no cover - runtime guard for serverless infra
        raise HTTPException(status_code=500, detail=str(error)) from error
