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
    return SimpleNamespace(text="Good morning what can I get you today")


class DubRoomSecurityTests(unittest.TestCase):
    def setUp(self):
        dub.ROOMS.clear()
        dub.transcribe_audio = fake_transcribe_audio
        app = FastAPI()
        app.include_router(dub.router, prefix="/api/dub")
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        dub.ROOMS.clear()

    def create_room(self):
        response = self.client.post(
            "/api/dub/rooms",
            json={"host_name": "Alice", "script_id": "sample-cafe"},
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["room_code"], response.json()["player_token"]

    def test_host_name_and_connected_player_name_cannot_be_taken_over(self):
        room_code, host_token = self.create_room()

        with self.client.websocket_connect(f"/api/dub/rooms/{room_code}/ws") as attacker:
            attacker.send_json({"type": "join", "name": "Alice", "character": "A"})
            self.assertEqual(
                attacker.receive_json(),
                {"type": "error", "detail": "host name is reserved"},
            )

        with self.client.websocket_connect(f"/api/dub/rooms/{room_code}/ws") as host:
            host.send_json(
                {
                    "type": "join",
                    "name": "Alice",
                    "character": "A",
                    "player_token": host_token,
                }
            )
            self.assertEqual(host.receive_json()["player_token"], host_token)
            host.receive_json()  # room_state

            with self.client.websocket_connect(f"/api/dub/rooms/{room_code}/ws") as duplicate:
                duplicate.send_json(
                    {
                        "type": "join",
                        "name": "Alice",
                        "character": "B",
                        "player_token": host_token,
                    }
                )
                self.assertEqual(
                    duplicate.receive_json(),
                    {"type": "error", "detail": "name is already taken"},
                )

    def test_scoring_turn_and_late_join_are_server_authorized(self):
        room_code, host_token = self.create_room()
        url = f"/api/dub/rooms/{room_code}/ws"
        audio = {"audio": ("recording.webm", b"audio", "audio/webm")}

        with self.client.websocket_connect(url) as host:
            host.send_json(
                {
                    "type": "join",
                    "name": "Alice",
                    "character": "A",
                    "player_token": host_token,
                }
            )
            host.receive_json()  # joined
            host.receive_json()  # room_state

            with self.client.websocket_connect(url) as guest:
                guest.send_json({"type": "join", "name": "Bob", "character": "B"})
                bob_token = guest.receive_json()["player_token"]
                host.receive_json()  # updated room_state
                guest.receive_json()  # room_state

                host.send_json({"type": "start"})
                host.receive_json()  # playing room_state
                guest.receive_json()  # playing room_state
                host.receive_json()  # line 1 turn
                guest.receive_json()  # line 1 turn

                response = self.client.post(
                    f"/api/dub/rooms/{room_code}/lines/1/score",
                    headers={"X-Player-Token": bob_token},
                    files=audio,
                )
                self.assertEqual(response.status_code, 403)

                response = self.client.post(
                    f"/api/dub/rooms/{room_code}/lines/2/score",
                    headers={"X-Player-Token": host_token},
                    files=audio,
                )
                self.assertEqual(response.status_code, 409)

                response = self.client.post(
                    f"/api/dub/rooms/{room_code}/lines/1/score",
                    headers={"X-Player-Token": host_token},
                    files=audio,
                )
                self.assertEqual(response.status_code, 200)

                host.send_json({"type": "line_done", "line_id": 1})
                self.assertEqual(host.receive_json()["line_id"], 2)
                self.assertEqual(guest.receive_json()["line_id"], 2)

                # Gecikmis/tekrar gonderilmis line_done aktif ikinci repligi
                # atlatmamali. Bob hala ikinci repligi puanlayabilmeli.
                host.send_json({"type": "line_done", "line_id": 1})
                response = self.client.post(
                    f"/api/dub/rooms/{room_code}/lines/2/score",
                    headers={"X-Player-Token": bob_token},
                    files=audio,
                )
                self.assertEqual(response.status_code, 200)

                with self.client.websocket_connect(url) as late_player:
                    late_player.send_json(
                        {"type": "join", "name": "Charlie", "character": "A"}
                    )
                    self.assertEqual(
                        late_player.receive_json(),
                        {"type": "error", "detail": "room is not accepting players"},
                    )


if __name__ == "__main__":
    unittest.main()
