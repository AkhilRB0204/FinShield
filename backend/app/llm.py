"""Which language model the explainer and the question feature use.

Detection never touches this module. It only decides who writes the words:

- ``gemini`` — Google Gemini, through its OpenAI-compatible endpoint. Needs
  ``GEMINI_API_KEY``. Has a free tier, which makes it the default for the
  hosted demo.
- ``ollama`` — a local model through Ollama's OpenAI-compatible endpoint. Needs
  nothing but a running Ollama; meant for development on your own machine.
- ``none`` — no model. The explainer uses its deterministic fallback and
  questions report that no model is configured.

``LLM_PROVIDER`` picks one. Left unset, Gemini is used when ``GEMINI_API_KEY``
is set; Ollama is only used when chosen explicitly, because a hosted backend has
no Ollama to reach. ``LLM_MODEL`` overrides the model name.

Gemini and Ollama share one code path: both speak the OpenAI chat-completions
format, so the same client with a different base URL serves either.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Literal, Optional

try:  # Optional at runtime: detection and the fallback never need it.
    import openai
except ImportError:  # pragma: no cover
    openai = None  # type: ignore[assignment]

if TYPE_CHECKING:
    from openai import OpenAI

Provider = Literal["gemini", "ollama", "none"]

_PROVIDERS: tuple[Provider, ...] = ("gemini", "ollama", "none")

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
OLLAMA_BASE_URL_DEFAULT = "http://localhost:11434/v1"

# Defaults per provider. Override with LLM_MODEL; model names change faster than code.
DEFAULT_MODELS: dict[str, str] = {
    "gemini": "gemini-2.5-flash",
    "ollama": "llama3.1",
}

DISPLAY_NAMES: dict[str, str] = {
    "gemini": "Gemini",
    "ollama": "the local model",
    "none": "a language model",
}


def provider() -> Provider:
    """The configured provider, resolved from the environment on every call."""
    chosen = os.environ.get("LLM_PROVIDER", "").strip().lower()
    if chosen in _PROVIDERS:
        return chosen  # type: ignore[return-value]
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    return "none"


def is_configured() -> bool:
    """Whether the chosen provider has what it needs to be called."""
    chosen = provider()
    if chosen == "gemini":
        return bool(os.environ.get("GEMINI_API_KEY")) and openai is not None
    if chosen == "ollama":
        return openai is not None
    return False


def display_name() -> str:
    return DISPLAY_NAMES[provider()]


def model_name() -> str:
    """The model to call: ``LLM_MODEL`` when set, else the provider's default."""
    override = os.environ.get("LLM_MODEL", "").strip()
    if override:
        return override
    return DEFAULT_MODELS.get(provider(), "")


_OPENAI_CLIENTS: dict[str, "OpenAI"] = {}


def openai_client() -> Optional["OpenAI"]:
    """A client for the configured provider, or ``None`` when unusable."""
    chosen = provider()
    if openai is None or chosen not in ("gemini", "ollama"):
        return None
    if chosen == "gemini":
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            return None
        base_url = GEMINI_BASE_URL
    else:
        key = "ollama"  # Ollama ignores the key, but the SDK requires one.
        base_url = os.environ.get("OLLAMA_BASE_URL", OLLAMA_BASE_URL_DEFAULT)
    cache_key = f"{chosen}:{base_url}"
    if cache_key not in _OPENAI_CLIENTS:
        _OPENAI_CLIENTS[cache_key] = openai.OpenAI(api_key=key, base_url=base_url, timeout=60.0)
    return _OPENAI_CLIENTS[cache_key]
