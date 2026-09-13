import sys
import unittest
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient


API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from routes import speech  # noqa: E402


class SpeechRouteTests(unittest.TestCase):
    def setUp(self):
        self.original_transcribe_audio = speech.transcribe_audio
        app = FastAPI()
        app.include_router(speech.router, prefix="/api/speech")
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        speech.transcribe_audio = self.original_transcribe_audio

    def test_preserves_upstream_rate_limit_and_retry_after(self):
        async def rate_limited(*_args, **_kwargs):
            request = httpx.Request("POST", "https://ai.example/stt")
            response = httpx.Response(
                429,
                request=request,
                headers={"Retry-After": "8"},
            )
            raise httpx.HTTPStatusError(
                "rate limited", request=request, response=response
            )

        speech.transcribe_audio = rate_limited
        response = self.client.post(
            "/api/speech/stt",
            files={"audio": ("recording.webm", b"audio", "audio/webm")},
        )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["retry-after"], "8")
        self.assertIn("retry in 8 seconds", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
