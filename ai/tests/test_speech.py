import base64
import unittest
from types import SimpleNamespace

from modules.speech import (
    GeminiSpeechToTextProvider,
    GeminiTextToSpeechProvider,
    SpeechRateLimitError,
)


class FakeInteractions:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


class FakeClient:
    def __init__(self, response):
        self.interactions = FakeInteractions(response)


class RateLimitError(Exception):
    status_code = 429


class SequencedInteractions:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class GeminiSpeechToTextProviderTests(unittest.TestCase):
    def test_uses_inline_audio_and_verbatim_mode(self):
        client = FakeClient(SimpleNamespace(output_text=" He go yesterday. "))
        provider = GeminiSpeechToTextProvider("", client=client)

        result = provider.transcribe(
            b"fake-wav",
            mime_type="audio/x-wav",
            language_codes=["en-US"],
            custom_vocabulary=["espresso"],
        )

        call = client.interactions.calls[0]
        self.assertEqual(result.text, "He go yesterday.")
        self.assertEqual(result.mode, "verbatim")
        self.assertEqual(call["input"][0]["mime_type"], "audio/wav")
        self.assertEqual(base64.b64decode(call["input"][0]["data"]), b"fake-wav")
        config = call["generation_config"]["transcription_config"]
        self.assertEqual(config["mode"], {"type": "verbatim"})
        self.assertEqual(config["language_codes"], ["en-US"])
        self.assertEqual(config["custom_vocabulary"], ["espresso"])

    def test_rejects_empty_audio(self):
        client = FakeClient(SimpleNamespace(output_text="unused"))
        provider = GeminiSpeechToTextProvider("", client=client)
        with self.assertRaises(ValueError):
            provider.transcribe(b"", mime_type="audio/wav")

    def test_retries_once_after_gemini_suggested_rate_limit_delay(self):
        interactions = SequencedInteractions(
            [
                RateLimitError("Please retry in 8.237s."),
                SimpleNamespace(output_text="hello"),
            ]
        )
        waits = []
        provider = GeminiSpeechToTextProvider(
            "",
            client=SimpleNamespace(interactions=interactions),
            sleep=waits.append,
        )

        result = provider.transcribe(b"audio", mime_type="audio/webm")

        self.assertEqual(result.text, "hello")
        self.assertEqual(len(interactions.calls), 2)
        self.assertEqual(waits, [9.0])

    def test_surfaces_rate_limit_after_retry_is_exhausted(self):
        interactions = SequencedInteractions(
            [
                RateLimitError("Please retry in 2s."),
                RateLimitError("Please retry in 7.4s."),
            ]
        )
        provider = GeminiSpeechToTextProvider(
            "",
            client=SimpleNamespace(interactions=interactions),
            sleep=lambda _seconds: None,
        )

        with self.assertRaises(SpeechRateLimitError) as raised:
            provider.transcribe(b"audio", mime_type="audio/webm")

        self.assertEqual(raised.exception.retry_after_seconds, 7.4)


class GeminiTextToSpeechProviderTests(unittest.TestCase):
    def test_wraps_pcm_response_as_wav(self):
        pcm = b"\x00\x00\x01\x00"
        response = SimpleNamespace(
            output_audio=SimpleNamespace(data=base64.b64encode(pcm).decode("ascii"))
        )
        client = FakeClient(response)
        provider = GeminiTextToSpeechProvider("", client=client)

        result = provider.synthesize(
            "Hello!", voice="Kore", style="Speak warmly."
        )

        self.assertEqual(result.mime_type, "audio/wav")
        self.assertEqual(result.audio[:4], b"RIFF")
        self.assertEqual(result.audio[8:12], b"WAVE")
        call = client.interactions.calls[0]
        self.assertEqual(call["response_format"], {"type": "audio"})
        self.assertEqual(
            call["generation_config"]["speech_config"], [{"voice": "Kore"}]
        )


if __name__ == "__main__":
    unittest.main()
