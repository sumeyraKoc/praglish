# Praglish Game Client

The Praglish game client is an isometric Phaser application for practicing
English through interactive role-play and scene dubbing. It uses Tiled maps and
game assets for the bakery and library environments.

The player character includes four-direction idle and walking animations. The
sprite sheet was produced for this project using a CC0 sheet layout as a
reference; attribution details are available in
`public/assets/characters/SOURCE.md`.

## Run with Docker

Docker is the recommended way to run the complete application. It does not
require a local Node.js installation:

```bash
docker compose up --build
```

Open `http://localhost:5173` after the services are ready.

## Run the client locally

Node.js 20 or newer is required only when developing the client outside Docker:

```bash
npm install
npm run dev
```

The client expects the API at `http://localhost:8000` by default. To use a
different endpoint, define `window.PRAGLISH_API_BASE_URL` before the game script
loads.

For interface-only development without Docker or Python, run the mock API in a
separate terminal:

```bash
npm run dev:mock-api
```

The mock server follows the same session, turn, vocabulary, and speech contracts
as the FastAPI service, but it is not real AI. Speech recognition returns a fixed
sample sentence and speech synthesis returns a valid silent WAV. Run the AI
container with a configured provider key for real STT and TTS.

## Controls

- Click the floor to move with A* pathfinding.
- Press `E` near an NPC to start a conversation, or near an object to open the
  vocabulary panel.
- Use the microphone button in a conversation to record speech. The client sends
  the recording to `/api/speech/stt` and plays the NPC response from
  `/api/speech/tts`.
- Press `Esc` to close a conversation or vocabulary panel.
- Press `B` to move from the library to the bakery.
- Press `L` to move from the bakery to the library.
- Press `P` to open the progress dashboard.
- Press `M` to return to the mode menu.

## Validation

```bash
npm run typecheck
npm run test
npm run build
```

The Maya and Lina dialogue panels use the API session and turn flow. AI replies,
corrections, and rewards appear in the same panel. Microphone input relies on the
browser `getUserMedia` and `MediaRecorder` APIs and works only in a secure context,
such as `http://localhost` or HTTPS.
