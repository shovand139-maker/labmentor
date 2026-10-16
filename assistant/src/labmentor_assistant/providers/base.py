"""Provider-neutral message types and the HTTP retry policy shared by the hosted providers."""

from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx2


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class UserMessage:
    content: str


@dataclass(frozen=True)
class AssistantMessage:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    name: str
    content: str
    is_error: bool = False


Message = UserMessage | AssistantMessage | ToolResult


@dataclass(frozen=True)
class ModelReply:
    text: str
    tool_calls: list[ToolCall]
    model: str
    input_tokens: int = 0
    output_tokens: int = 0


class ProviderError(Exception):
    """The model could not be reached or refused the request."""

    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class Provider(Protocol):
    name: str
    model: str

    async def complete(self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]) -> ModelReply: ...


RETRYABLE_STATUS = frozenset({408, 409, 425, 429, 500, 502, 503, 504, 529})
Sleep = Callable[[float], Awaitable[None]]


def _retry_after(response: httpx2.Response) -> float | None:
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


async def post_json(
    client: httpx2.AsyncClient,
    url: str,
    *,
    headers: dict[str, str],
    body: dict[str, Any],
    attempts: int = 3,
    sleep: Sleep = asyncio.sleep,
    max_backoff: float = 8.0,
) -> dict[str, Any]:
    """POST with retries on throttling, overload and transient network errors.

    Honors ``retry-after`` up to ``max_backoff`` seconds, otherwise backs off exponentially with jitter. Errors
    that will not change on retry (400, 401, 403, 404, 422) fail at once.
    """
    last_error: ProviderError | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = await client.post(url, headers=headers, json=body)
        except httpx2.TransportError as error:
            last_error = ProviderError(f"network error: {error.__class__.__name__}", retryable=True)
            delay = None
        else:
            if response.status_code < 400:
                data: dict[str, Any] = response.json()
                return data
            retryable = response.status_code in RETRYABLE_STATUS
            last_error = ProviderError(
                f"provider returned {response.status_code}", status=response.status_code, retryable=retryable
            )
            if not retryable:
                raise last_error
            delay = _retry_after(response)
        if attempt == attempts:
            break
        backoff = delay if delay is not None else 0.5 * 2 ** (attempt - 1) + random.uniform(0, 0.25)  # noqa: S311
        await sleep(min(max_backoff, backoff))
    assert last_error is not None
    raise last_error
