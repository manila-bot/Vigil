"""Thin Nemotron client for an OpenAI-compatible endpoint (NVIDIA API catalog or OpenRouter).
Server-side only. Each provider gets only its own key."""
import httpx

from .. import config

PROVIDERS = ("nvidia", "openrouter")


class ProviderError(Exception):
    """Model call failed. `public` is safe to show users; `detail` (provider body) is for logs/terminal."""

    def __init__(self, public: str, detail: str = ""):
        super().__init__(public)
        self.public = public
        self.detail = detail


def provider() -> str:
    return config.NEMOTRON_PROVIDER


def _api_key() -> str:
    if config.NEMOTRON_PROVIDER == "openrouter":
        return config.OPENROUTER_API_KEY
    if config.NEMOTRON_PROVIDER == "nvidia":
        return config.NVIDIA_API_KEY
    return ""


def live_enabled() -> bool:
    return config.NEMOTRON_ENABLED and config.NEMOTRON_PROVIDER in PROVIDERS and bool(_api_key())


def describe() -> str:
    """e.g. 'openrouter · nvidia/nemotron-3-super-120b-a12b:free'"""
    return f"{config.NEMOTRON_PROVIDER} · {config.NEMOTRON_MODEL}"


def _headers() -> dict:
    h = {"Authorization": f"Bearer {_api_key()}", "Accept": "application/json"}
    if config.NEMOTRON_PROVIDER == "openrouter":
        h["X-Title"] = "Vigil (HackUTD demo)"  # optional attribution header; no user data
    return h


def _error_detail(r: httpx.Response) -> str:
    try:
        err = r.json().get("error", r.json())
        if isinstance(err, dict):
            meta = err.get("metadata") or {}
            raw = meta.get("raw") or meta.get("provider_name") or ""
            return f"{err.get('message', '')} {raw}".strip()[:500]
        return str(err)[:500]
    except ValueError:
        return r.text[:500]


def chat(messages: list, tools=None, max_tokens: int = 1500) -> dict:
    """One chat-completions call. Returns the assistant message dict."""
    if config.NEMOTRON_PROVIDER not in PROVIDERS:
        raise ProviderError(f"Unknown NEMOTRON_PROVIDER '{config.NEMOTRON_PROVIDER}'.")
    body = {"model": config.NEMOTRON_MODEL, "messages": messages, "temperature": 0.2, "max_tokens": max_tokens}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    name = "OpenRouter" if config.NEMOTRON_PROVIDER == "openrouter" else "NVIDIA"
    try:
        r = httpx.post(f"{config.NEMOTRON_BASE_URL}/chat/completions", json=body, timeout=config.NEMOTRON_TIMEOUT,
                       headers=_headers())
    except httpx.TimeoutException as exc:
        raise ProviderError(f"Nemotron ({name}) did not respond in time.", str(exc))
    except httpx.HTTPError as exc:
        raise ProviderError(f"Couldn't reach Nemotron ({name}).", str(exc))
    detail = _error_detail(r) if r.status_code >= 400 else ""
    if r.status_code in (401, 403):
        raise ProviderError(f"{name} rejected the API key ({r.status_code}).", detail)
    if r.status_code == 402:
        raise ProviderError(f"{name} says the account has no credit for this model (402).", detail)
    if r.status_code == 404:
        raise ProviderError(f"Model {config.NEMOTRON_MODEL} isn't available on {name} for this account (404).", detail)
    if r.status_code == 429:
        raise ProviderError(f"{name} rate limit reached (429). Wait a moment and retry.", detail)
    if r.status_code >= 400:
        raise ProviderError(f"{name} returned an error ({r.status_code}).", detail)
    try:
        data = r.json()
        if "error" in data and not data.get("choices"):  # OpenRouter can return 200 with an error body
            raise ProviderError(f"{name} returned an error.", _error_detail(r))
        return data["choices"][0]["message"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise ProviderError(f"{name} sent an unreadable response.", r.text[:500])
