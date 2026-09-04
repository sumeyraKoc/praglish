import base64
import unittest
from types import SimpleNamespace

from ai.modules.speech import (
    GeminiSpeechToTextProvider,
    GeminiTextToSpeechProvider,
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
