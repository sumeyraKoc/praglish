from __future__ import annotations

import base64
import io
import time
import wave
from dataclasses import dataclass
from typing import Protocol


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
