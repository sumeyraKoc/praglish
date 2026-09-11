import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient


API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from routes import dub  # noqa: E402


async def fake_transcribe_audio(*_args, **_kwargs):
    return SimpleNamespace(text="placeholder transcript")


class DubScriptTests(unittest.TestCase):
    def setUp(self):
        self.original_transcribe_audio = dub.transcribe_audio
        dub.transcribe_audio = fake_transcribe_audio
        app = FastAPI()
        app.include_router(dub.router, prefix="/api/dub")
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        dub.transcribe_audio = self.original_transcribe_audio

    def test_scripts_are_returned_in_unique_difficulty_order(self):
        response = self.client.get("/api/dub/scripts")

        self.assertEqual(response.status_code, 200)
        scripts = response.json()
        self.assertEqual(len(scripts), len(dub.SCRIPTS))
        self.assertEqual(
            [script["level"] for script in scripts],
            list(range(1, len(scripts) + 1)),
        )
        self.assertEqual(
            [script["difficulty_score"] for script in scripts],
            sorted(script["difficulty_score"] for script in scripts),
        )
        for script in scripts:
            self.assertTrue(script["characters"])
            self.assertTrue(script["lines"])

    def test_score_line_uses_stt_and_returns_word_level_accuracy(self):
        script = min(dub.SCRIPTS.values(), key=lambda item: item.level)
        line = script.lines[0]

        async def exact_transcription(*_args, **_kwargs):
            return SimpleNamespace(text=line.text.lower())

        dub.transcribe_audio = exact_transcription
        response = self.client.post(
            f"/api/dub/scripts/{script.id}/lines/{line.id}/score",
            files={"audio": ("recording.webm", b"audio", "audio/webm")},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["expected"], line.text)
        self.assertEqual(payload["transcript"], line.text.lower())
        self.assertEqual(payload["accuracy_percent"], 100.0)
        self.assertTrue(all(word["correct"] for word in payload["words"]))

    def test_score_line_rejects_unknown_targets_and_empty_audio(self):
        script = min(dub.SCRIPTS.values(), key=lambda item: item.level)
        line = script.lines[0]
        audio = {"audio": ("recording.webm", b"audio", "audio/webm")}

        unknown_script = self.client.post(
            f"/api/dub/scripts/not-a-script/lines/{line.id}/score",
            files=audio,
        )
        unknown_line = self.client.post(
            f"/api/dub/scripts/{script.id}/lines/999999/score",
            files=audio,
        )
        empty_audio = self.client.post(
            f"/api/dub/scripts/{script.id}/lines/{line.id}/score",
            files={"audio": ("recording.webm", b"", "audio/webm")},
        )

        self.assertEqual(unknown_script.status_code, 404)
        self.assertEqual(unknown_line.status_code, 404)
        self.assertEqual(empty_audio.status_code, 400)


if __name__ == "__main__":
    unittest.main()
