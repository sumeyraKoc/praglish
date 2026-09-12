import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch




AI_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_DIR))
import main as ai_main  # noqa: E402


class TTSConfigurationTests(unittest.TestCase):
    def tearDown(self):
        ai_main.get_tts_provider.cache_clear()

    @patch.object(ai_main, "GeminiTextToSpeechProvider")
    def test_dedicated_gemini_tts_key_takes_priority(self, provider):
        with patch.dict(
            os.environ,
            {
                "GEMINI_TTS_API_KEY": "paid-tts-key",
                "GEMINI_API_KEY": "shared-free-key",
                "TTS_MODEL": "tts-model",
            },
        ):
            ai_main.get_tts_provider.cache_clear()
            ai_main.get_tts_provider()

        provider.assert_called_once_with(api_key="paid-tts-key", model="tts-model")

    @patch.object(ai_main, "GeminiTextToSpeechProvider")
    def test_blank_dedicated_key_falls_back_to_existing_gemini_key(self, provider):
        with (
            patch.dict(
                os.environ,
                {
                    "GEMINI_TTS_API_KEY": "",
                    "GEMINI_API_KEY": "shared-free-key",
                    "TTS_MODEL": "tts-model",
                },
            ),
            patch.object(ai_main, "_active_ai_provider", return_value="gemini"),
        ):
            ai_main.get_tts_provider.cache_clear()
            ai_main.get_tts_provider()

        provider.assert_called_once_with(api_key="shared-free-key", model="tts-model")

    @patch.object(ai_main, "GroqTextToSpeechProvider")
    def test_blank_dedicated_key_preserves_existing_groq_setup(self, provider):
        with (
            patch.dict(
                os.environ,
                {
                    "GEMINI_TTS_API_KEY": "",
                    "GROQ_API_KEY": "existing-groq-key",
                    "GROQ_TTS_MODEL": "groq-tts-model",
                },
            ),
            patch.object(ai_main, "_active_ai_provider", return_value="groq"),
        ):
            ai_main.get_tts_provider.cache_clear()
            ai_main.get_tts_provider()

        provider.assert_called_once_with(
            api_key="existing-groq-key",
            model="groq-tts-model",
        )


if __name__ == "__main__":
    unittest.main()
