import io
import logging
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile


AI_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_DIR))
import main as ai_main  # noqa: E402


class FailingSpeechProvider:
    _model = "test-transcription-model"

    def transcribe(self, *_args, **_kwargs):
        raise RuntimeError("upstream diagnostic message")


class STTEndpointLoggingTests(unittest.IsolatedAsyncioTestCase):
    async def test_logs_provider_exception_and_returns_reference(self):
        upload = UploadFile(
            filename="recording.webm",
            file=io.BytesIO(b"fake-audio"),
            headers={"content-type": "audio/webm"},
        )

        with (
            patch.object(ai_main, "get_stt_provider", return_value=FailingSpeechProvider()),
            self.assertLogs("uvicorn.error", level=logging.ERROR) as captured,
        ):
            with self.assertRaises(HTTPException) as raised:
                await ai_main.speech_to_text(upload, language_code="en-US")

        self.assertEqual(raised.exception.status_code, 502)
        self.assertIn("reference:", raised.exception.detail)
        self.assertNotIn("upstream diagnostic message", raised.exception.detail)
        combined_logs = "\n".join(captured.output)
        self.assertIn("STT request failed", combined_logs)
        self.assertIn("FailingSpeechProvider", combined_logs)
        self.assertIn("test-transcription-model", combined_logs)
        self.assertIn("RuntimeError", combined_logs)
        self.assertIn("upstream diagnostic message", combined_logs)


if __name__ == "__main__":
    unittest.main()
