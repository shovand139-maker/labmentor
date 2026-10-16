from __future__ import annotations

import json
from typing import Any

import httpx2
import pytest

from labmentor_assistant.config import Settings
from labmentor_assistant.providers import provider_from_settings
from labmentor_assistant.providers.anthropic import AnthropicProvider, to_anthropic_messages
from labmentor_assistant.providers.azure_openai import AzureOpenAIProvider
from labmentor_assistant.providers.base import (
    AssistantMessage,
    ProviderError,
    ToolCall,
    ToolResult,
    ToolSpec,
    UserMessage,
)
from labmentor_assistant.providers.offline import OfflineProvider

TOOLS = [ToolSpec("search_guide", "Search the guide.", {"type": "object", "properties": {"query": {"type": "string"}}})]
CONVERSATION = [
    UserMessage("How do I see logs?"),
    AssistantMessage("", [ToolCall("t1", "search_guide", {"query": "logs"}), ToolCall("t2", "learner_progress", {})]),
    ToolResult("t1", "search_guide", "<passage ...>"),
    ToolResult("t2", "learner_progress", '{"current_step": 6}', is_error=False),
]


class Recorder:
    def __init__(self, *responses: httpx2.Response) -> None:
        self.responses = list(responses)
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return self.responses.pop(0)

    def body(self, i: int = 0) -> dict[str, Any]:
        data: dict[str, Any] = json.loads(self.requests[i].content)
        return data


async def no_sleep(_: float) -> None:
    return None


def client(recorder: Recorder) -> httpx2.AsyncClient:
    return httpx2.AsyncClient(transport=httpx2.MockTransport(recorder))


def test_anthropic_tool_results_share_one_user_turn_and_roles_alternate() -> None:
    converted = to_anthropic_messages([*CONVERSATION, UserMessage("and then?")])

    assert [m["role"] for m in converted] == ["user", "assistant", "user"]
    assert [b["type"] for b in converted[1]["content"]] == ["tool_use", "tool_use"]
    assert [b["type"] for b in converted[2]["content"]] == ["tool_result", "tool_result", "text"]
    assert converted[2]["content"][0]["tool_use_id"] == "t1"


async def test_anthropic_request_and_response_mapping() -> None:
    recorder = Recorder(
        httpx2.Response(
            200,
            json={
                "model": "claude-test",
                "content": [
                    {"type": "text", "text": "Searching."},
                    {"type": "tool_use", "id": "toolu_1", "name": "search_guide", "input": {"query": "logs"}},
                ],
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 321, "output_tokens": 12},
            },
        )
    )
    provider = AnthropicProvider(api_key="sk-test", model="claude-test", client=client(recorder), sleep=no_sleep)

    result = await provider.complete("system prompt", CONVERSATION[:1], TOOLS)

    request = recorder.requests[0]
    assert request.url == "https://api.anthropic.com/v1/messages"
    assert request.headers["x-api-key"] == "sk-test"
    assert request.headers["anthropic-version"] == "2023-06-01"
    body = recorder.body()
    assert body["system"] == "system prompt"
    assert body["tools"][0]["input_schema"]["properties"]["query"]["type"] == "string"
    assert result.text == "Searching."
    assert result.tool_calls == [ToolCall("toolu_1", "search_guide", {"query": "logs"})]
    assert (result.input_tokens, result.output_tokens, result.model) == (321, 12, "claude-test")


async def test_throttling_is_retried_and_honours_retry_after() -> None:
    waits: list[float] = []

    async def record_sleep(seconds: float) -> None:
        waits.append(seconds)

    recorder = Recorder(
        httpx2.Response(429, headers={"retry-after": "2"}),
        httpx2.Response(529),
        httpx2.Response(200, json={"content": [{"type": "text", "text": "ok"}], "usage": {}}),
    )
    provider = AnthropicProvider(api_key="k", model="m", client=client(recorder), sleep=record_sleep)

    result = await provider.complete("s", [UserMessage("q")], [])

    assert result.text == "ok"
    assert len(recorder.requests) == 3
    assert waits[0] == 2.0
    assert 1.0 <= waits[1] <= 1.25


async def test_errors_that_will_not_change_fail_without_retrying() -> None:
    recorder = Recorder(httpx2.Response(401, json={"error": {"message": "invalid x-api-key"}}))
    provider = AnthropicProvider(api_key="k", model="m", client=client(recorder), sleep=no_sleep)

    with pytest.raises(ProviderError) as error:
        await provider.complete("s", [UserMessage("q")], [])

    assert error.value.status == 401 and not error.value.retryable
    assert len(recorder.requests) == 1


async def test_retries_give_up_after_the_last_attempt() -> None:
    recorder = Recorder(*(httpx2.Response(503) for _ in range(3)))
    provider = AnthropicProvider(api_key="k", model="m", client=client(recorder), sleep=no_sleep)

    with pytest.raises(ProviderError) as error:
        await provider.complete("s", [UserMessage("q")], [])

    assert error.value.retryable and error.value.status == 503


async def test_azure_openai_request_and_response_mapping() -> None:
    recorder = Recorder(
        httpx2.Response(
            200,
            json={
                "model": "gpt-test",
                "choices": [
                    {
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "type": "function",
                                    "function": {"name": "search_guide", "arguments": '{"query":"logs"}'},
                                },
                                {
                                    "id": "c2",
                                    "type": "function",
                                    "function": {"name": "get_step", "arguments": "{not json"},
                                },
                            ],
                        },
                    }
                ],
                "usage": {"prompt_tokens": 50, "completion_tokens": 9},
            },
        )
    )
    provider = AzureOpenAIProvider(
        endpoint="https://contoso.openai.azure.com/",
        deployment="mentor",
        api_key="az-key",
        client=client(recorder),
        sleep=no_sleep,
    )

    result = await provider.complete("system prompt", CONVERSATION, TOOLS)

    request = recorder.requests[0]
    assert str(request.url) == (
        "https://contoso.openai.azure.com/openai/deployments/mentor/chat/completions?api-version=2024-10-21"
    )
    assert request.headers["api-key"] == "az-key"
    messages = recorder.body()["messages"]
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "tool", "tool"]
    assert json.loads(messages[2]["tool_calls"][0]["function"]["arguments"]) == {"query": "logs"}
    assert result.tool_calls[0].arguments == {"query": "logs"}
    assert "__invalid_json__" in result.tool_calls[1].arguments
    assert (result.input_tokens, result.output_tokens) == (50, 9)


async def test_azure_openai_can_authenticate_with_an_entra_token() -> None:
    recorder = Recorder(httpx2.Response(200, json={"choices": [{"message": {"content": "hi"}}]}))

    async def token() -> str:
        return "entra-token"

    provider = AzureOpenAIProvider(
        endpoint="https://contoso.openai.azure.com",
        deployment="mentor",
        token_provider=token,
        client=client(recorder),
    )

    result = await provider.complete("s", [UserMessage("q")], [])

    assert recorder.requests[0].headers["authorization"] == "Bearer entra-token"
    assert "api-key" not in recorder.requests[0].headers
    assert result.text == "hi"


async def test_content_filter_blocks_are_provider_errors() -> None:
    recorder = Recorder(httpx2.Response(200, json={"choices": [{"finish_reason": "content_filter", "message": {}}]}))
    provider = AzureOpenAIProvider(
        endpoint="https://x.openai.azure.com", deployment="d", api_key="k", client=client(recorder)
    )

    with pytest.raises(ProviderError, match="content filter"):
        await provider.complete("s", [UserMessage("q")], [])


def test_the_provider_comes_from_settings() -> None:
    assert isinstance(provider_from_settings(Settings()), OfflineProvider)
    anthropic = provider_from_settings(Settings.from_env({"LLM_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "k"}))
    assert isinstance(anthropic, AnthropicProvider) and anthropic.model == "claude-sonnet-5-5"
    azure = provider_from_settings(
        Settings.from_env(
            {
                "LLM_PROVIDER": "azure-openai",
                "AZURE_OPENAI_ENDPOINT": "https://x",
                "AZURE_OPENAI_DEPLOYMENT": "d",
                "AZURE_OPENAI_API_KEY": "k",
            }
        )
    )
    assert isinstance(azure, AzureOpenAIProvider)


def test_misconfiguration_fails_at_startup() -> None:
    with pytest.raises(ValueError, match="LLM_PROVIDER"):
        Settings.from_env({"LLM_PROVIDER": "gpt"})
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        provider_from_settings(Settings.from_env({"LLM_PROVIDER": "anthropic"}))
