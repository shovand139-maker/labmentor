"""Settings from environment variables. Everything has a safe default except secrets."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

ProviderName = Literal["offline", "anthropic", "azure-openai"]


@dataclass(frozen=True)
class Settings:
    provider: ProviderName = "offline"
    service_key: str | None = None
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-5-5"
    azure_openai_endpoint: str | None = None
    azure_openai_deployment: str | None = None
    azure_openai_api_key: str | None = None
    azure_openai_api_version: str = "2024-10-21"
    max_tool_rounds: int = 5

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        e = os.environ if env is None else env
        provider = e.get("LLM_PROVIDER", "offline").strip().lower()
        if provider not in ("offline", "anthropic", "azure-openai"):
            raise ValueError(f"LLM_PROVIDER must be offline, anthropic or azure-openai, not {provider!r}")
        return cls(
            provider=provider,  # type: ignore[arg-type]
            service_key=e.get("ASSISTANT_SERVICE_KEY") or None,
            anthropic_api_key=e.get("ANTHROPIC_API_KEY") or None,
            anthropic_model=e.get("ANTHROPIC_MODEL", cls.anthropic_model),
            azure_openai_endpoint=e.get("AZURE_OPENAI_ENDPOINT") or None,
            azure_openai_deployment=e.get("AZURE_OPENAI_DEPLOYMENT") or None,
            azure_openai_api_key=e.get("AZURE_OPENAI_API_KEY") or None,
            azure_openai_api_version=e.get("AZURE_OPENAI_API_VERSION", cls.azure_openai_api_version),
            max_tool_rounds=int(e.get("MAX_TOOL_ROUNDS", cls.max_tool_rounds)),
        )
