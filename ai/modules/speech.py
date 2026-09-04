from __future__ import annotations

import base64
import io
import time
import wave
from dataclasses import dataclass
from typing import Protocol

from .groq_client import (
    DEFAULT_GROQ_STT_MODEL,
    DEFAULT_GROQ_TTS_MODEL,
    build_groq_client,
)


SUPPORTED_AUDIO_MIME_TYPES = {
    "audio/aac",
    "audio/aiff",
    "audio/alaw",
    "audio/flac",
    "audio/l16",
    "audio/m4a",
    "audio/mp3",
    "audio/mpeg",
    "audio/mulaw",
    "audio/ogg",
    "audio/opus",
    "audio/wav",
    "audio/webm",
}

# Groq's /audio/transcriptions (Whisper) only accepts this subset - see
# https://console.groq.com/docs/speech-to-text. A handful of the raw PCM-ish
# formats Gemini accepts (aac/aiff/alaw/l16/mulaw) aren't in it, so
# GroqSpeechToTextProvider checks against this narrower set and fails fast
# with a clear error instead of a confusing 400 from Groq.
GROQ_SUPPORTED_AUDIO_MIME_TYPES = {
    "audio/flac",
    "audio/m4a",
    "audio/mp3",
    "audio/mpeg",
    "audio/ogg",
    "audio/opus",
    "audio/wav",
    "audio/webm",
}

_MIME_TO_FILE_EXTENSION = {
    "audio/flac": "flac",
    "audio/m4a": "m4a",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/wav": "wav",
    "audio/webm": "webm",
}

# Groq's Orpheus TTS voices (English) - see
# https://console.groq.com/docs/text-to-speech. Gemini voice names (e.g. the
# "Kore" default used across this project) aren't valid here, so
# GroqTextToSpeechProvider falls back to _GROQ_DEFAULT_VOICE for anything it
# doesn't recognize instead of forwarding an invalid name to Groq.
GROQ_TTS_VOICES = {
    "aaliyah",
    "adam",
    "angelo",
    "arsenio",
    "autumn",
    "austin",
    "axel",
    "cillian",
    "eric",
    "hannah",
    "jesse",
    "julia",
    "leah",
    "leo",
    "mia",
    "nia",
    "quinn",
    "ruby",
    "sam",
    "troy",
}
_GROQ_DEFAULT_VOICE = "hannah"


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    model: str
    mode: str
    language_code: str | None
    latency_ms: int


@dataclass(frozen=True)
class SpeechAudioResult:
    audio: bytes
    mime_type: str
    model: str
    voice: str
    sample_rate_hz: int
    latency_ms: int


class SpeechToTextProvider(Protocol):
    def transcribe(
        self,
        audio: bytes,
        *,
        mime_type: str,
        language_codes: list[str] | None = None,
        custom_vocabulary: list[str] | None = None,
    ) -> TranscriptionResult: ...


class TextToSpeechProvider(Protocol):
    def synthesize(
        self,
        text: str,
        *,
        voice: str,
        style: str,
    ) -> SpeechAudioResult: ...


class GeminiSpeechToTextProvider:
    """Short-form Gemini transcription adapter using verbatim mode."""

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-3.5-transcribe",
        *,
        client=None,
    ):
        if client is None:
            if not api_key:
                raise ValueError("GEMINI_API_KEY is not defined")
            try:
                from google import genai
            except ImportError as exc:
                raise RuntimeError(
                    "Gemini dependency is missing. Run "
                    "'pip install -r ai/requirements.txt' to install it."
                ) from exc
            client = genai.Client(api_key=api_key)

        self._client = client
        self._model = model

    def transcribe(
        self,
        audio: bytes,
        *,
        mime_type: str,
        language_codes: list[str] | None = None,
        custom_vocabulary: list[str] | None = None,
    ) -> TranscriptionResult:
        if not audio:
            raise ValueError("audio cannot be empty")
        mime_type = _normalize_mime_type(mime_type)
        if mime_type not in SUPPORTED_AUDIO_MIME_TYPES:
            raise ValueError(f"unsupported audio MIME type: {mime_type}")

        transcription_config: dict = {
            "mode": {"type": "verbatim"},
            "language_codes": language_codes or [],
        }
        if custom_vocabulary:
            transcription_config["custom_vocabulary"] = custom_vocabulary[:100]

        started = time.perf_counter()
        interaction = self._client.interactions.create(
            model=self._model,
            input=[
                {
                    "type": "audio",
                    "data": base64.b64encode(audio).decode("ascii"),
                    "mime_type": mime_type,
                }
            ],
            generation_config={"transcription_config": transcription_config},
        )
        latency_ms = round((time.perf_counter() - started) * 1000)
        transcript = (interaction.output_text or "").strip()
        if not transcript:
            raise RuntimeError("Gemini returned an empty transcript")

        return TranscriptionResult(
            text=transcript,
            model=self._model,
            mode="verbatim",
            language_code=language_codes[0] if language_codes else None,
            latency_ms=latency_ms,
        )


class GroqSpeechToTextProvider:
    """Groq Whisper adapter (OpenAI-compatible `POST /audio/transcriptions`).

    Whisper is inherently a literal transcriber (it doesn't rewrite grammar),
    so - like Gemini's explicit verbatim mode - it never "corrects" what the
    player says before the language evaluator sees it.
    """

    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_GROQ_STT_MODEL,
        *,
        client=None,
    ):
        self._client = client or build_groq_client(api_key)
        self._model = model

    def transcribe(
        self,
        audio: bytes,
        *,
        mime_type: str,
        language_codes: list[str] | None = None,
        custom_vocabulary: list[str] | None = None,
    ) -> TranscriptionResult:
        if not audio:
            raise ValueError("audio cannot be empty")
        mime_type = _normalize_mime_type(mime_type)
        if mime_type not in GROQ_SUPPORTED_AUDIO_MIME_TYPES:
            raise ValueError(f"unsupported audio MIME type for Groq: {mime_type}")

        extension = _MIME_TO_FILE_EXTENSION[mime_type]
        data: dict[str, str] = {"model": self._model, "response_format": "verbose_json"}
        language_code = language_codes[0] if language_codes else None
        if language_code:
            # Whisper wants a bare ISO-639-1 code ("en"), not a BCP-47 tag
            # ("en-US") - the game/AI service pass the latter by default.
            data["language"] = language_code.split("-")[0].lower()
        if custom_vocabulary:
            # Whisper has no dedicated vocabulary list; a short "prompt" is
            # its documented way to bias transcription toward specific terms.
            data["prompt"] = ", ".join(custom_vocabulary[:100])

        started = time.perf_counter()
        response = self._client.post(
            "/audio/transcriptions",
            data=data,
            files={"file": (f"recording.{extension}", audio, mime_type)},
        )
        response.raise_for_status()
        latency_ms = round((time.perf_counter() - started) * 1000)
        transcript = (response.json().get("text") or "").strip()
        if not transcript:
            raise RuntimeError("Groq returned an empty transcript")

        return TranscriptionResult(
            text=transcript,
            model=self._model,
            mode="verbatim",
            language_code=language_code,
            latency_ms=latency_ms,
        )


class GeminiTextToSpeechProvider:
    """Gemini TTS adapter returning a playable 24 kHz mono WAV."""

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-3.1-flash-tts-preview",
        *,
        client=None,
    ):
        if client is None:
            if not api_key:
                raise ValueError("GEMINI_API_KEY is not defined")
            try:
                from google import genai
            except ImportError as exc:
                raise RuntimeError(
                    "Gemini dependency is missing. Run "
                    "'pip install -r ai/requirements.txt' to install it."
                ) from exc
            client = genai.Client(api_key=api_key)

        self._client = client
        self._model = model

    def synthesize(
        self,
        text: str,
        *,
        voice: str = "Kore",
        style: str = "Speak naturally, warmly, and at a patient conversational pace.",
    ) -> SpeechAudioResult:
        text = text.strip()
        if not text:
            raise ValueError("text cannot be empty")

        prompt = f"{style}\nRead the following text exactly:\n{text}"
        started = time.perf_counter()
        interaction = self._client.interactions.create(
            model=self._model,
            input=prompt,
            response_format={"type": "audio"},
            generation_config={"speech_config": [{"voice": voice}]},
        )
        latency_ms = round((time.perf_counter() - started) * 1000)

        output_audio = getattr(interaction, "output_audio", None)
        encoded_audio = getattr(output_audio, "data", None)
        if not encoded_audio:
            raise RuntimeError("Gemini returned an empty TTS response")
        pcm = (
            base64.b64decode(encoded_audio)
            if isinstance(encoded_audio, str)
            else bytes(encoded_audio)
        )

        return SpeechAudioResult(
            audio=_pcm_to_wav(pcm),
            mime_type="audio/wav",
            model=self._model,
            voice=voice,
            sample_rate_hz=24_000,
            latency_ms=latency_ms,
        )


class GroqTextToSpeechProvider:
    """Groq TTS adapter (OpenAI-compatible `POST /audio/speech`, Orpheus voices).

    Unlike Gemini's TTS, Groq's endpoint already returns a complete WAV file
    with `response_format="wav"`, so no raw-PCM-to-WAV conversion is needed
    here.
    """

    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_GROQ_TTS_MODEL,
        *,
        client=None,
    ):
        self._client = client or build_groq_client(api_key)
        self._model = model

    def synthesize(
        self,
        text: str,
        *,
        voice: str = _GROQ_DEFAULT_VOICE,
        style: str = "Speak naturally, warmly, and at a patient conversational pace.",
    ) -> SpeechAudioResult:
        text = text.strip()
        if not text:
            raise ValueError("text cannot be empty")

        # `voice` may be a Gemini voice name (e.g. the project-wide "Kore"
        # default) if the caller didn't know which provider is active -
        # silently fall back to a valid Groq voice instead of erroring.
        resolved_voice = voice.strip().lower()
        if resolved_voice not in GROQ_TTS_VOICES:
            resolved_voice = _GROQ_DEFAULT_VOICE

        started = time.perf_counter()
        response = self._client.post(
            "/audio/speech",
            json={
                "model": self._model,
                "voice": resolved_voice,
                "input": text,
                "response_format": "wav",
            },
        )
        response.raise_for_status()
        latency_ms = round((time.perf_counter() - started) * 1000)
        audio = response.content
        if not audio:
            raise RuntimeError("Groq returned an empty TTS response")

        return SpeechAudioResult(
            audio=audio,
            mime_type="audio/wav",
            model=self._model,
            voice=resolved_voice,
            sample_rate_hz=24_000,
            latency_ms=latency_ms,
        )


class TextSpeechModule:
    """Text-only development fallback retained for the terminal pipeline."""

    def speech_to_text(self, text_input: str) -> str:
        return text_input.strip()

    def text_to_speech(self, text: str) -> str:
        return text


def _normalize_mime_type(mime_type: str) -> str:
    clean = mime_type.split(";", maxsplit=1)[0].strip().lower()
    return "audio/wav" if clean in {"audio/x-wav", "audio/wave"} else clean


def _pcm_to_wav(
    pcm: bytes,
    *,
    channels: int = 1,
    sample_rate_hz: int = 24_000,
    sample_width: int = 2,
) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate_hz)
        wav_file.writeframes(pcm)
    return output.getvalue()
