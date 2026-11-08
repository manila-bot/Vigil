"""Thin Nemotron client for NVIDIA's OpenAI-compatible endpoint. Server-side only."""
import httpx

from .. import config


class ProviderError(Exception):
    """Model call failed. `public` is safe to show users; details stay in server logs."""

    def __init__(self, public: str, detail: str = ""):
        super().__init__(public)
        self.public = public
        self.detail = detail


def live_enabled() -> bool:
    return config.NEMOTRON_ENABLED and bool(config.NVIDIA_API_KEY)


def chat(messages: list, tools=None, max_tokens: int = 1500) -> dict:
    """One chat-completions call. Returns the assistant message dict."""
    body = {"model": config.NEMOTRON_MODEL, "messages": messages, "temperature": 0.2, "max_tokens": max_tokens}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    try:
        r = httpx.post(f"{config.NEMOTRON_BASE_URL}/chat/completions", json=body, timeout=config.NEMOTRON_TIMEOUT,
                       headers={"Authorization": f"Bearer {config.NVIDIA_API_KEY}", "Accept": "application/json"})
    except httpx.TimeoutException as exc:
        raise ProviderError("Nemotron did not respond in time.", str(exc))
    except httpx.HTTPError as exc:
        raise ProviderError("Couldn't reach Nemotron.", str(exc))
    if r.status_code in (401, 403):
        raise ProviderError("Nemotron rejected the API key.", r.text[:300])
    if r.status_code == 429:
        raise ProviderError("Nemotron rate limit reached. Wait a moment and retry.", r.text[:300])
    if r.status_code >= 400:
        raise ProviderError(f"Nemotron returned an error ({r.status_code}).", r.text[:500])
    try:
        return r.json()["choices"][0]["message"]
    except (ValueError, KeyError, IndexError):
        raise ProviderError("Nemotron sent an unreadable response.", r.text[:500])
