"""Model providers. Pick one with LLM_PROVIDER: offline (default), anthropic or azure-openai."""

from __future__ import annotations

from ..config import Settings
from .anthropic import AnthropicProvider
from .azure_openai import AzureOpenAIProvider, TokenProvider
from .base import Provider, ProviderError
from .offline import OfflineProvider


def _managed_identity_token_provider() -> TokenProvider:
    """Entra ID tokens for Azure OpenAI from the app's managed identity (requires the 'azure' extra)."""
    try:
        from azure.identity.aio import DefaultAzureCredential  # type: ignore[import-not-found]
    except ImportError as error:  # pragma: no cover - depends on optional extra
        raise ValueError("install labmentor-assistant[azure] to use managed identity with Azure OpenAI") from error
    credential = DefaultAzureCredential()

    async def token() -> str:
        result = await credential.get_token("https://cognitiveservices.azure.com/.default")
        return str(result.token)

    return token


def provider_from_settings(settings: Settings) -> Provider:
    if settings.provider == "offline":
        return OfflineProvider()
    if settings.provider == "anthropic":
        return AnthropicProvider(api_key=settings.anthropic_api_key or "", model=settings.anthropic_model)
    if settings.provider == "azure-openai":
        return AzureOpenAIProvider(
            endpoint=settings.azure_openai_endpoint or "",
            deployment=settings.azure_openai_deployment or "",
            api_key=settings.azure_openai_api_key,
            token_provider=None if settings.azure_openai_api_key else _managed_identity_token_provider(),
            api_version=settings.azure_openai_api_version,
        )
    raise ValueError(f"unknown LLM_PROVIDER {settings.provider!r}")


__all__ = [
    "AnthropicProvider",
    "AzureOpenAIProvider",
    "OfflineProvider",
    "Provider",
    "ProviderError",
    "provider_from_settings",
]
