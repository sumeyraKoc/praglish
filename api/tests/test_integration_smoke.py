
from __future__ import annotations

import json
import os
import unittest
import urllib.error
import urllib.request

API_URL = os.getenv("SMOKE_API_URL", "http://localhost:8000")
AI_URL = os.getenv("SMOKE_AI_URL", "http://localhost:8001")
GAME_URL = os.getenv("SMOKE_GAME_URL", "http://localhost:5173")
TIMEOUT_SECONDS = float(os.getenv("SMOKE_TIMEOUT_SECONDS", "10"))






TURN_TIMEOUT_SECONDS = float(os.getenv("SMOKE_TURN_TIMEOUT_SECONDS", "130"))


def _request(
    method: str,
    url: str,
    payload: dict | None = None,
    *,
    timeout: float = TIMEOUT_SECONDS,
) -> tuple[int, object]:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status, raw_body = response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        status, raw_body = exc.code, exc.read().decode("utf-8")

    try:
        return status, json.loads(raw_body)
    except json.JSONDecodeError:
        return status, raw_body


def _service_reachable(url: str) -> bool:
    try:
        status, _ = _request("GET", url)
        return status < 500
    except (urllib.error.URLError, OSError):
        return False


class IntegrationSmokeTest(unittest.TestCase):

    username: str = ""

    @classmethod
    def setUpClass(cls) -> None:
        missing = [
            f"{name} ({url})"
            for name, url in (("api", API_URL), ("ai", AI_URL), ("game", GAME_URL))
            if not _service_reachable(url)
        ]
        if missing:
            raise unittest.SkipTest(
                "The following services are unavailable, so the test is skipped: "
                + ", ".join(missing)
                + ". Make sure `docker compose up -d --build` is running. When "
                "testing inside a container, set SMOKE_AI_URL and SMOKE_GAME_URL "
                "to the Docker Compose service URLs (for example, "
                "http://ai:8001 and http://game:5173)."
            )
        cls.username = f"smoketest_{os.getpid()}"

    def test_01_api_health(self) -> None:
        status, body = _request("GET", f"{API_URL}/health")
        self.assertEqual(status, 200)
        self.assertEqual(body.get("status"), "ok")

    def test_02_ai_health(self) -> None:
        status, _ = _request("GET", f"{AI_URL}/health")
        self.assertEqual(status, 200)

    def test_03_game_serves_index(self) -> None:
        status, _ = _request("GET", GAME_URL)
        self.assertEqual(status, 200)

    def test_04_full_turn_roundtrip(self) -> None:

        status, body = _request(
            "POST",
            f"{API_URL}/api/session/start",
            {
                "username": self.username,
                "password": "smoketest-pw-123",
                "location": "bakery",
                "npc_role": "baker",
            },
        )
        self.assertEqual(status, 200, f"session start failed: {body}")
        session_id = body["session_id"]

        status, body = _request(
            "POST",
            f"{API_URL}/api/session/{session_id}/turn",
            {"user_text": "Could I get a croissant, please?"},
            timeout=TURN_TIMEOUT_SECONDS,
        )
        self.assertEqual(status, 200, f"first turn failed: {body}")
        for field in ("accepted", "npc_response", "response_speaker"):
            self.assertIn(field, body, f"response is missing '{field}': {body}")




        status, body = _request(
            "POST",
            f"{API_URL}/api/session/{session_id}/turn",
            {"user_text": "Thank you very much!"},
            timeout=TURN_TIMEOUT_SECONDS,
        )
        self.assertEqual(status, 200, f"second turn failed: {body}")

    def test_05_dashboard_reflects_session(self) -> None:

        status, body = _request(
            "POST",
            f"{API_URL}/api/analytics/dashboard",
            {"username": self.username, "password": "smoketest-pw-123"},
        )
        self.assertEqual(status, 200, f"dashboard request failed: {body}")
        self.assertGreaterEqual(body["summary"]["total_turns"], 2, body)


if __name__ == "__main__":
    unittest.main()
