"""Claude through the Anthropic Messages API, with tool use."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
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

API_VERSION = "2023-06-01"


def to_anthropic_messages(messages: Sequence[Message]) -> list[dict[str, Any]]:
    """Convert neutral messages to the Messages API shape.

    Tool results go back as ``tool_result`` blocks in a user turn, and consecutive results share one turn, which
    the API requires. Adjacent turns with the same role are merged so roles always alternate.
    """
    out: list[dict[str, Any]] = []

    def push(role: str, blocks: list[dict[str, Any]]) -> None:
        if out and out[-1]["role"] == role:
            out[-1]["content"].extend(blocks)
        else:
            out.append({"role": role, "content": blocks})

    for message in messages:
        if isinstance(message, UserMessage):
            push("user", [{"type": "text", "text": message.content}])
        elif isinstance(message, AssistantMessage):
            blocks: list[dict[str, Any]] = []
            if message.text.strip():
                blocks.append({"type": "text", "text": message.text})
            blocks.extend(
                {"type": "tool_use", "id": call.id, "name": call.name, "input": call.arguments}
                for call in message.tool_calls
            )
            if blocks:
                push("assistant", blocks)
        elif isinstance(message, ToolResult):
            push(
                "user",
                [
                    {
                        "type": "tool_result",
                        "tool_use_id": message.call_id,
                        "content": message.content,
                        "is_error": message.is_error,
                    }
                ],
            )
    return out


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = "https://api.anthropic.com",
        max_tokens: int = 1024,
        client: httpx2.AsyncClient | None = None,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required for the anthropic provider")
        self.model = model
        self._api_key = api_key
        self._url = f"{base_url.rstrip('/')}/v1/messages"
        self._max_tokens = max_tokens
        self._client = client or httpx2.AsyncClient(timeout=httpx2.Timeout(60.0, connect=5.0))
        self._sleep = sleep

    async def complete(self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]) -> ModelReply:
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self._max_tokens,
            "system": system,
            "messages": to_anthropic_messages(messages),
        }
        if tools:
            body["tools"] = [
                {"name": t.name, "description": t.description, "input_schema": t.parameters} for t in tools
            ]
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
        }
        data = await post_json(self._client, self._url, headers=headers, body=body, sleep=self._sleep)

        content = data.get("content")
        if not isinstance(content, list):
            raise ProviderError("unexpected response: no content")
        text = "".join(block.get("text", "") for block in content if block.get("type") == "text")
        calls = [
            ToolCall(id=block["id"], name=block["name"], arguments=block.get("input") or {})
            for block in content
            if block.get("type") == "tool_use"
        ]
        usage = data.get("usage") or {}
        return ModelReply(
            text=text,
            tool_calls=calls,
            model=str(data.get("model", self.model)),
            input_tokens=int(usage.get("input_tokens", 0)),
            output_tokens=int(usage.get("output_tokens", 0)),
        )
