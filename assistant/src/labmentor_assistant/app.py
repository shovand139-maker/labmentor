"""HTTP API. The web app is the only caller; it authenticates with a shared service key."""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
from collections.abc import AsyncIterator
from contextlib import suppress
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import StreamingResponse

from . import __version__
from .agent import answer_question
from .config import Settings
from .models import AnswerRequest, AnswerResult
from .providers import Provider, ProviderError, provider_from_settings
from .retrieval import IndexCache

log = logging.getLogger("labmentor.api")


def sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode()


def create_app(settings: Settings | None = None, provider: Provider | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    provider = provider or provider_from_settings(settings)
    indexes = IndexCache()
    app = FastAPI(title="LabMentor assistant", version=__version__)

    def require_service_key(x_service_key: Annotated[str | None, Header()] = None) -> None:
        if settings.service_key is None:
            return
        if x_service_key is None or not hmac.compare_digest(x_service_key, settings.service_key):
            raise HTTPException(status_code=401, detail="missing or wrong X-Service-Key")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "provider": provider.name, "model": provider.model, "version": __version__}

    @app.post("/v1/answer", dependencies=[Depends(require_service_key)], response_model=None)
    async def answer(
        request: AnswerRequest, stream: Annotated[bool, Query()] = True
    ) -> AnswerResult | StreamingResponse:
        if not stream:
            try:
                return await answer_question(request, provider, indexes, max_rounds=settings.max_tool_rounds)
            except ProviderError as error:
                raise HTTPException(status_code=503, detail=f"model unavailable: {error}") from error
        return StreamingResponse(
            _stream(request),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )

    async def _stream(request: AnswerRequest) -> AsyncIterator[bytes]:
        """Tool progress streams as it happens. The answer is sent after the output checks, in short pieces.

        Streaming raw model tokens would show the learner text that the solution check may still replace.
        """
        queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        async def emit(event: str, data: dict[str, Any]) -> None:
            await queue.put(sse(event, data))

        async def run() -> None:
            try:
                result = await answer_question(
                    request, provider, indexes, emit=emit, max_rounds=settings.max_tool_rounds
                )
                words = result.answer.split(" ")
                for i in range(0, len(words), 6):
                    piece = " ".join(words[i : i + 6]) + (" " if i + 6 < len(words) else "")
                    await queue.put(sse("delta", {"text": piece}))
                await queue.put(sse("done", result.model_dump()))
            except ProviderError as error:
                log.warning("provider error: %s", error)
                await queue.put(
                    sse(
                        "error",
                        {
                            "code": "model_unavailable",
                            "message": "The assistant is unavailable. Try again in a minute.",
                        },
                    )
                )
            except Exception:
                log.exception("answer failed")
                await queue.put(sse("error", {"code": "internal", "message": "Something went wrong while answering."}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(run())
        try:
            while (item := await queue.get()) is not None:
                yield item
        finally:
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    return app
