"""A model deployed in Azure OpenAI, through chat completions with function calling."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Sequence
from typing import Any

import httpx2

from .base import (
    AssistantMessage,
    Message,
    ModelReply,
    ProviderError,
    Sleep,
    ToolCall,
    ToolResult,
    ToolSpec,
    UserMessage,
    post_json,
)

DEFAULT_API_VERSION = "2024-10-21"
TokenProvider = Callable[[], Awaitable[str]]


def to_chat_messages(system: str, messages: Sequence[Message]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for message in messages:
        if isinstance(message, UserMessage):
            out.append({"role": "user", "content": message.content})
        elif isinstance(message, AssistantMessage):
            entry: dict[str, Any] = {"role": "assistant", "content": message.text or None}
            if message.tool_calls:
                entry["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
                    }
                    for call in message.tool_calls
                ]
            out.append(entry)
        elif isinstance(message, ToolResult):
            out.append({"role": "tool", "tool_call_id": message.call_id, "content": message.content})
    return out


def _parse_arguments(raw: object) -> dict[str, Any]:
    """Models occasionally send malformed JSON. Pass that on as an argument error instead of failing the turn."""
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
    except json.JSONDecodeError:
        return {"__invalid_json__": str(raw)[:200]}
    return parsed if isinstance(parsed, dict) else {"__invalid_json__": str(raw)[:200]}


class AzureOpenAIProvider:
    name = "azure-openai"

    def __init__(
        self,
        *,
        endpoint: str,
        deployment: str,
        api_key: str | None = None,
        token_provider: TokenProvider | None = None,
        api_version: str = DEFAULT_API_VERSION,
        client: httpx2.AsyncClient | None = None,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        if not endpoint or not deployment:
            raise ValueError("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT are required for azure-openai")
        if not api_key and token_provider is None:
            raise ValueError("set AZURE_OPENAI_API_KEY or use a managed identity token provider")
        self.model = deployment
        self._url = f"{endpoint.rstrip('/')}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"
        self._api_key = api_key
        self._token_provider = token_provider
        self._client = client or httpx2.AsyncClient(timeout=httpx2.Timeout(60.0, connect=5.0))
        self._sleep = sleep

    async def _headers(self) -> dict[str, str]:
        if self._api_key:
            return {"api-key": self._api_key, "content-type": "application/json"}
        assert self._token_provider is not None
        return {"authorization": f"Bearer {await self._token_provider()}", "content-type": "application/json"}

    async def complete(self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]) -> ModelReply:
        body: dict[str, Any] = {"messages": to_chat_messages(system, messages)}
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {"name": t.name, "description": t.description, "parameters": t.parameters},
                }
                for t in tools
            ]
            body["tool_choice"] = "auto"
        data = await post_json(self._client, self._url, headers=await self._headers(), body=body, sleep=self._sleep)

        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ProviderError("unexpected response: no choices")
        choice = choices[0]
        if choice.get("finish_reason") == "content_filter":
            raise ProviderError("the response was blocked by the content filter", status=400)
        message = choice.get("message") or {}
        calls = [
            ToolCall(
                id=call["id"],
                name=call["function"]["name"],
                arguments=_parse_arguments(call["function"].get("arguments")),
            )
            for call in message.get("tool_calls") or []
            if call.get("type", "function") == "function"
        ]
        usage = data.get("usage") or {}
        return ModelReply(
            text=message.get("content") or "",
            tool_calls=calls,
            model=str(data.get("model", self.model)),
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
        )
