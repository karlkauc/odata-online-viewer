"""Built-in sample services: public OData endpoints plus bundled snapshots of
their metadata for when the live service is down."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.api.metadata import _parse_and_store, load_from_url
from app.odata.model import ServiceModel
from app.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["samples"])

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "odata" / "samples"


class Sample(BaseModel):
    id: str
    name: str
    description: str
    odata_version: str
    service_url: str | None = None
    data: bool = False
    auth: bool = False


class SamplesResponse(BaseModel):
    samples: list[Sample]


@lru_cache(maxsize=1)
def _catalog() -> list[dict]:
    return json.loads((SAMPLES_DIR / "samples.json").read_text(encoding="utf-8"))


def _find(sample_id: str) -> dict:
    for entry in _catalog():
        if entry["id"] == sample_id:
            return entry
    raise HTTPException(status_code=404, detail="unknown sample")


@router.get("/samples", response_model=SamplesResponse)
@limiter.limit(READ_LIMIT)
async def list_samples(request: Request) -> SamplesResponse:
    return SamplesResponse(
        samples=[Sample(**{k: v for k, v in e.items() if k != "file"}) for e in _catalog()]
    )


@router.post("/samples/{sample_id}/load", response_model=ServiceModel)
@limiter.limit(WRITE_LIMIT)
async def load_sample(request: Request, sample_id: str, live: bool = True) -> ServiceModel:
    """Load a sample: from the live service when possible (so the data explorer
    works), else from the bundled snapshot."""
    entry = _find(sample_id)
    if live and entry.get("service_url"):
        try:
            return load_from_url(entry["service_url"], None, source="sample")
        except HTTPException as exc:
            logger.warning("live sample %s unavailable: %s", sample_id, exc.detail)
            notice = (
                f"The live service {entry['service_url']} is not reachable right now ({exc.detail}). "
                "Showing a bundled snapshot of its metadata; data browsing is unavailable."
            )
    else:
        notice = None
    path = SAMPLES_DIR / entry["file"]
    return _parse_and_store(
        path.read_bytes(),
        filename=entry["file"],
        source="sample",
        notices=[notice] if notice else None,
    )
