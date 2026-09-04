"""Shared helpers for the Groq adapters (`Groq*Provider` classes in this package).

Groq exposes an OpenAI-compatible REST API (https://api.groq.com/openai/v1), so
these adapters talk to it directly with `httpx` instead of pulling in the
separate `groq` SDK package - one less dependency to install/pin, and the
request/response shapes below are simple enough that a thin wrapper is all we
need. Every `Groq*Provider` class mirrors the `Gemini*Provider` class next to
it (same constructor shape, same Protocol), so `ai/main.py` can pick either
family at runtime based on which API key is configured (see
`_active_ai_provider()` there).
"""

from __future__ import annotations

import httpx

GROQ_API_BASE = "https://api.groq.com/openai/v1"

# https://console.groq.com/docs/models - "versatile" text model: used for NPC
# dialogue, where character voice/quality matters most.
DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"
# Groq's "instant" tier - much lower latency, meant for exactly this kind of
# short, latency-sensitive JSON output (a percent + one sentence, or a
# corrected sentence + a short coach tip). Used as the default for the
# evaluator and correction steps, which sit on the critical path the player
# waits on for every single turn - unlike NPC dialogue and the extractors
# (the latter already run in a FastAPI background task), a slow evaluator
# call is the one that a player feels as "the game is thinking forever".
DEFAULT_GROQ_FAST_MODEL = "llama-3.1-8b-instant"
DEFAULT_GROQ_STT_MODEL = "whisper-large-v3-turbo"
DEFAULT_GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english"


def build_groq_client(api_key: str, *, timeout: float = 60.0) -> httpx.Client:
    if not api_key:
        raise ValueError("GROQ_API_KEY is not defined")
    return httpx.Client(
        base_url=GROQ_API_BASE,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=timeout,
    )


def groq_chat_json(
    client: httpx.Client,
    *,
    model: str,
    system_instruction: str,
    user_content: str,
    temperature: float = 0,
) -> str:
    """Run a JSON-mode chat completion and return the raw text content.

    Groq's `response_format={"type": "json_object"}` (its JSON mode)
    guarantees syntactically valid JSON but, unlike Gemini's
    `response_json_schema`, does not enforce a specific schema - so the
    schema is spelled out in `system_instruction` and the caller validates
    the result against a pydantic model afterwards.
    """

    response = client.post(
        "/chat/completions",
        json={
            "model": model,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_content},
            ],
        },
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    if not content:
        raise RuntimeError("Groq returned an empty response")
    return content


def json_schema_instruction(schema: dict) -> str:
    import json

    return (
        "\n\nRespond with ONLY a single JSON object matching this JSON schema. "
        "No prose, no markdown code fences, no extra keys.\n"
        f"{json.dumps(schema)}"
    )
