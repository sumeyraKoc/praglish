"""
Uctan uca "duman testi" (smoke test): docker-compose ile ayaga kaldirilmis
UC servisi (game, api, ai) + Postgres DB'yi gercek HTTP istekleriyle dener.

api/tests ve ai/tests altindaki diger dosyalardan FARKLIDIR: onlar tek bir
fonksiyonu izole (DB/ag olmadan) test eder, bu dosya ise gercek bir oyuncu
turunu (oturum ac -> iki tur oyna -> dashboard'da gorunuyor mu) butun sistem
ayaktayken dener. 3 servis + DB gibi hareketli parca sayisi arttikca bir
env degiskeninin docker-compose.yml'den yanlislikla silinmesi, bir servisin
digerine ulasamamasi gibi seyler sessizce kirilabiliyor - bu test, demodan
once "hepsi gercekten birlikte calisiyor mu" sorusuna tek komutla cevap
vermek icin var.

Nasil calistirilir
-------------------
Once butun sistemi ayaga kaldirin:

    docker compose up -d --build

Sonra, makinenizde Python 3.10+ varsa (ekstra bir bagimlilik GEREKMEZ -
sadece standart kutuphane kullanilir), depo kokunden calistirin:

    python api/tests/test_integration_smoke.py

Makinenizde Python yoksa (bu proje Node.js icin de Docker kullaniyor -
game/README'deki npm notuna bakin), zaten ayakta olan `api` container'i
icinden calistirin; bu durumda `ai`/`game` servislerine docker-compose'un
kendi ic agindaki servis adlariyla ulasilir:

    docker compose exec api sh -c "SMOKE_AI_URL=http://ai:8001 SMOKE_GAME_URL=http://game:5173 python tests/test_integration_smoke.py"

USE_MOCK_AI ile ilgisi yoktur: .env dosyanizda USE_MOCK_AI=true olsun ya da
olmasin bu test calisir - mock modda api hic ai servisine gitmeden sabit bir
cevap dondugu, gercek modda ise dogru sekilde ai servisine gidip bir cevap
alindigi icin, iki durumda da game/api/ai/db zincirinin gercekten uctan uca
calistigi dogrulanmis olur. USE_MOCK_AI=false (gercek Gemini/Groq) iken bir
tur birkac saniyeden fazla surebilir - bu yuzden tur/dashboard istekleri
health-check'lerden ayrı, daha uzun bir zaman asimi (SMOKE_TURN_TIMEOUT_SECONDS,
varsayilan 130s) kullanir.
"""

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
# Bir tur, USE_MOCK_AI=false iken gercek Gemini/Groq'a gidip donuyor - bu,
# health-check gibi hafif isteklerden onemli olcude daha uzun surebilir
# (ozellikle ilk/soguk cagri). api'nin kendi ai_client.py > AI_EVALUATION_TIMEOUT_SECONDS
# degeri varsayilan 120s - onun biraz uzerine ayarlayarak, gercekten donen bir
# hata (502/500) varsa bizim istemci timeout'umuzun degil, api'nin kendi
# hata mesajinin gorunmesini sagliyoruz.
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
    """game + api + ai + db'yi birlikte, gercek HTTP istekleriyle dener."""

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
                "Su servislere ulasilamadi, atlaniyor: "
                + ", ".join(missing)
                + ". Once `docker compose up -d --build` calistirdiginizdan emin "
                "olun; container icinden calistiriyorsaniz SMOKE_AI_URL / "
                "SMOKE_GAME_URL degiskenlerini docker-compose servis adlarina "
                "(orn. http://ai:8001, http://game:5173) ayarlayin."
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
        """Oturum ac -> iki tur oyna -> her ikisi de dogru sekilde cevap versin."""

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
        self.assertEqual(status, 200, f"session start basarisiz: {body}")
        session_id = body["session_id"]

        status, body = _request(
            "POST",
            f"{API_URL}/api/session/{session_id}/turn",
            {"user_text": "Could I get a croissant, please?"},
            timeout=TURN_TIMEOUT_SECONDS,
        )
        self.assertEqual(status, 200, f"1. tur basarisiz: {body}")
        for field in ("accepted", "npc_response", "response_speaker"):
            self.assertIn(field, body, f"cevapta '{field}' eksik: {body}")

        # Ikinci tur: build_evaluator_history'nin ilk turu DB'den geri okuyup
        # ai/mock katmanina dogru gonderdigini, yani oturumun gercekten
        # yazilip okundugunu dolayli olarak dogrular.
        status, body = _request(
            "POST",
            f"{API_URL}/api/session/{session_id}/turn",
            {"user_text": "Thank you very much!"},
            timeout=TURN_TIMEOUT_SECONDS,
        )
        self.assertEqual(status, 200, f"2. tur basarisiz: {body}")

    def test_05_dashboard_reflects_session(self) -> None:
        """Az once oynanan turlarin PRAGLISH JOURNAL dashboard'ina yansidigini dogrula."""

        status, body = _request(
            "POST",
            f"{API_URL}/api/analytics/dashboard",
            {"username": self.username, "password": "smoketest-pw-123"},
        )
        self.assertEqual(status, 200, f"dashboard basarisiz: {body}")
        self.assertGreaterEqual(body["summary"]["total_turns"], 2, body)


if __name__ == "__main__":
    unittest.main()
