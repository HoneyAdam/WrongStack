from django.http import HttpRequest, HttpResponse
from pydantic import BaseModel


class HealthResponse(BaseModel):
    ok: bool


def health(_request: HttpRequest) -> HttpResponse:
    payload = HealthResponse(ok=True)
    return HttpResponse(payload.model_dump_json(), content_type="application/json")