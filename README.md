# Praglish

**[English](#english) · [Türkçe](#turkce)**

<a id="english"></a>
## English

### Game client

The working Phaser MVP lives in `game/`. It renders isometric bakery and
library maps; click-to-walk, A* pathfinding, furniture collisions, and the
AI-powered Maya and Lina NPCs.

```bash
cd game
npm install
npm run dev
```

Game: http://localhost:5173

See `game/README.md` for details.

### Architecture

- **api/** (Zehra) — FastAPI, session/scenario/vocabulary/reward logic, DB. Light dependencies.
- **ai/** (Sümeyra) — STT, TTS, Language Evaluator, NPC Engine. Heavy ML dependencies.
- **shared/schemas.py** — Common Pydantic models used by both. Let each other know
  before touching this file, since both containers depend on it.

### Running it

```bash
cp .env.example .env   # fill in GEMINI_API_KEY (or GROQ_API_KEY)
docker compose up --build
```

#### AI provider: Gemini + Groq (redundancy)

**Every** AI call in the `ai` service (language evaluation, correction coach,
extractors, NPC dialogue, STT, TTS) is bound not to one provider but to a
shared Protocol interface (the `*Provider` classes in `ai/modules/*.py`).
This gives us two separate concrete implementations of the same job:
`Gemini*Provider` and `Groq*Provider`. `ai/main.py > _active_ai_provider()`
decides which one to use with this rule:

- `GEMINI_API_KEY` set in `.env` → Gemini is used (the default behavior so
  far, nothing changed).
- `GEMINI_API_KEY` empty/removed and `GROQ_API_KEY` set → **all** AI calls
  automatically fall back to Groq.
- Both empty → you get an explicit error on the first AI call (not at the
  health check): `"No AI provider is configured..."`.

So if Gemini has an outage/limit issue, deleting (or blanking) the
`GEMINI_API_KEY` line in `.env`, filling in `GROQ_API_KEY`, and restarting
only the `ai` container with `docker compose up --build ai` is enough — no
change is needed on the `api` or `game` side, both keep calling the same
`/evaluate-and-respond`, `/stt`, `/tts` etc. endpoints on `ai`.

Groq goes directly to Groq's OpenAI-compatible REST endpoints via `httpx`
instead of the `groq` SDK (`ai/modules/groq_client.py`), so no extra
dependency was needed:

| Capability | Gemini | Groq |
|---|---|---|
| Language evaluation / correction / extractors (structured JSON) | `gemini-3.5-flash-lite`, `response_json_schema` | `llama-3.3-70b-versatile`, JSON mode (`GROQ_MODEL`) |
| NPC dialogue | `gemini-3.5-flash-lite` | `llama-3.3-70b-versatile` (`GROQ_MODEL`) |
| STT | `gemini-3.5-transcribe`, verbatim mode | `whisper-large-v3-turbo` (`GROQ_STT_MODEL`) — Whisper already transcribes verbatim, it doesn't correct grammar |
| TTS | `gemini-3.1-flash-tts-preview`, 24 kHz WAV | `canopylabs/orpheus-v1-english` (`GROQ_TTS_MODEL`), already returns WAV |

An optional `GEMINI_TTS_API_KEY` can be set to keep TTS spend on a separate
Gemini project (e.g. one with billing enabled). If set, only TTS uses this
key; if blank, it falls back to `GEMINI_API_KEY` so existing setups keep
working.

Note: Gemini's and Groq's voice names differ (`Kore` vs. `hannah`/`troy`/...).
If `GroqTextToSpeechProvider` sees a voice name it doesn't recognize (e.g. the
default `Kore`) it silently falls back to its own default instead of
erroring — the game side doesn't need to know which provider is active.

This is not **runtime**, per-request automatic failover (i.e. if a Gemini
call fails mid-request, that request doesn't instantly drop to Groq) —
whichever key is set in `.env` is the provider that's used. If real
request-level failover is wanted with both keys filled in, that's an easy
next step.

#### Running the full stack on Windows

In a new PowerShell window, clone the repo and enter the project folder:

```powershell
git clone https://github.com/sumeyraKoc/praglish.git
cd praglish
Copy-Item .env.example .env
# Replace the GEMINI_API_KEY (or GROQ_API_KEY) value in .env with your own key.
docker compose up --build -d
docker compose ps
```

The `db` row should show `healthy`; `api`, `ai`, and `game` should show `Up`.
To follow all services' logs:

```powershell
docker compose logs -f game api ai db
```

The game is also started by Compose inside a Node.js 24 container; you don't
need to install Node.js or npm on your machine separately. Open
`http://localhost:5173`. The Maya and Lina chat clients use the real API at
`http://localhost:8000` by default. To try the flow without a Gemini/Groq key,
add `USE_MOCK_AI=true` to `.env`.

To stop the containers only:

```powershell
docker compose down
```

To fully reset, deliberately deleting the PostgreSQL data too, use
`docker compose down -v`.

- api → http://localhost:8000/docs
- ai  → http://localhost:8001/docs (`GET /health` also returns the active provider: `{"ai_provider": "gemini" | "groq" | "unconfigured"}`)

#### Terminal AI pipeline demo

A text-in/text-out terminal pipeline demo (`ai/cli.py`, currently only works
with Gemini) is available. The real STT/TTS endpoints in the AI service are
used separately. The Language Evaluator estimates a contextual plausibility
percentage for `P(U | C,S,L,G)`. A sentence that doesn't pass the adjustable
threshold goes to the Correction Module; an accepted sentence goes to the NPC:

```bash
pip install -r ai/requirements.txt
python -m ai.cli
```

The NPC only keeps Language-Evaluator-accepted user sentences and its own
replies in the conversation history.

After the evaluator's decision, every sentence goes to one of two extractors:

- `CorrectExtractor`: extracts correctly used grammar topics, noun/adjective
  CEFR levels, and idioms.
- `IncorrectExtractor`: extracts only the grammar, vocabulary, and idiom
  categories where a concrete mistake was found.

The AI service has two completely separate extractor endpoints:

- `POST /extract/correct` uses only the `ai/prompts/correct_extractor.txt` prompt,
- `POST /extract/incorrect` uses only the `ai/prompts/incorrect_extractor.txt` prompt.

Both request bodies contain only the current sentence:

```json
{"utterance": "Could I get a coffee, please?"}
```

Context, role, goal, dialogue history, and the evaluator's reasoning are not
sent to the extractor. The API service atomically saves the structured result
to the raw event table in PostgreSQL and to separate `correct`/`incorrect`
counters. If the same `dialogue_id` is processed again, the counters aren't
incremented a second time.

#### Correction coach

When the evaluator rejects a sentence, the correction module sends only the
last rejected sentence and the filtered dialogue history given to the
evaluator to the active AI provider (Gemini or Groq). The output carries the
corrected sentence and a short coach note in separate fields. This flow runs
automatically inside `python -m ai.cli`. To try the module independently via
the AI service:

```powershell
$body = @{
  utterance = "I go to school yesterday."
  dialogue_history = @(
    @{ speaker = "npc"; text = "Where did you go yesterday?" }
  )
} | ConvertTo-Json -Depth 4

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8001/correct" `
  -ContentType "application/json" `
  -Body $body
```

In-game, the same coach message for a rejected sentence is shown under the
`COACH` label rather than the NPC's name. The incorrect sentence and the
coach message are not saved to the dialogue history.

#### First STT/TTS pass

The AI service's `POST /stt` endpoint sends short push-to-talk recordings to
the active provider (Gemini `gemini-3.5-transcribe` or Groq
`whisper-large-v3-turbo`). Transcription is always in `verbatim` mode, so the
student's grammar mistakes and hesitations aren't cleaned up before reaching
the evaluator.

```bash
curl -X POST "http://localhost:8001/stt?language_code=en-US&custom_vocabulary=espresso,latte" \
  -F "audio=@sample.wav"
```

`POST /tts` converts text to WAV with the active provider's TTS (Gemini: 24 kHz
mono; Groq: Orpheus, already WAV):

```bash
curl -X POST http://localhost:8001/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Certainly. Would you like milk?","voice":"Kore"}' \
  --output npc.wav
```

The first prototype is file/single-sentence based. Streaming and
barge-in support will be added once the push-to-talk flow is validated.

The acceptance threshold can be changed from `.env`; example value:

```env
LANGUAGE_ACCEPTANCE_THRESHOLD=50
```

#### Speaking practice in-game (microphone → STT → turn → TTS)

The game client no longer calls the `ai` service's `/stt`/`/tts` endpoints
**directly**; both are proxied through the `api` service
(`POST /api/speech/stt`, `POST /api/speech/tts` — see `api/routes/speech.py`
+ `api/services/ai_client.py`). This is deliberate: the game side
(`PraglishApiClient.ts`) only needs to know one base URL
(`http://localhost:8000`), CORS is only defined on `api`, and there's no need
to add CORS to `ai/main.py` as well.

Flow: pressing the 🎤 button on the Maya/Lina dialogue panel starts a
`MediaRecorder` recording in the browser (pressing again stops it) → the
recording is sent to `/api/speech/stt` → the returned **verbatim** text
(grammar mistakes not corrected) goes to `/api/session/{id}/turn` just like a
normal typed message, so the accept/correct/reward logic works the same way
whether typed or spoken → the NPC's reply is played back from
`/api/speech/tts` (the text is already shown in the panel too; if playback
fails — no mic permission, the browser blocked autoplay, the `ai` container
is down — it fails silently).

Real transcription/synthesis requires the `ai` container to be up **with
`GEMINI_API_KEY` or `GROQ_API_KEY`**; `docker compose up` already starts it.
When testing with `npm run dev:mock-api` (no Docker, game only),
`game/scripts/mock-api.mjs` now returns a fixed sample sentence for
`/api/speech/stt` and a valid but **silent** WAV for `/api/speech/tts` — the
goal isn't audio quality but seeing that the microphone → text → turn → audio
playback flow runs end to end without breaking.

Browser note: `getUserMedia` (microphone permission) only works in a "secure
context" — `http://localhost` is an exception to this so there's no issue in
development, but if you open the game with `http://` from another
machine/URL on demo day, the browser will refuse microphone access; HTTPS is
required in that case.

When there's a schema change (e.g. a new **column** added in
`models/models.py`), `create_all()` doesn't update existing tables — in that
case:
```bash
docker compose down -v
docker compose up --build
```
Adding a new **table** doesn't require this reset, `create_all()` just
creates the missing tables.

### Common errors

#### "Backend is unavailable at localhost:8000" / CORS error in the browser, but curl/DevTools show CORS is correct

This exact scenario happened while building this project, and the real cause
was **not** CORS: there was a mismatch between the `User` model at the moment
`api`'s container first brought up Postgres, and the `password_hash` field
added to the model afterward — `Base.metadata.create_all()` does **not**
update existing tables (only creates missing ones, see the "schema change"
note above), i.e. an old `pgdata` volume's `users` table never had a
`password_hash` column at all. This caused a real SQL error and a 500 at
`/api/session/start`:

```
psycopg2.errors.UndefinedColumn: column users.password_hash does not exist
```

The genuinely confusing part: when an unexpected error (not an
`HTTPException`) blows up inside a route, Starlette's
`ServerErrorMiddleware` that catches it sits **outside** `CORSMiddleware` —
so the resulting 500 response never gets CORS headers added to it. The
browser then shows not the real 500 but "No 'Access-Control-Allow-Origin'
header is present", even though the CORS setting itself (see
`CORSMiddleware` in `api/main.py`) was entirely correct — which is also why
`curl` and DevTools' Network tab showed the `OPTIONS` preflight returning 200.
We fixed this at two levels:

1. **Permanent code fix**: a global `@app.exception_handler(Exception)` was
   added to `api/main.py`. This routes unexpected errors into FastAPI's
   normal (correctly CORS-header-adding) error-handling layer — so even if a
   genuinely unrelated 500 happens later, it won't look like a "CORS error"
   and send you down the wrong path for hours; the real error
   (`{"detail": "Internal server error"}`, full traceback in the logs) shows up.
2. **Fix for this specific case**: reset the volume to match the schema the
   model (`api/models/models.py`) expects with the actual Postgres table:

   ```bash
   docker compose down -v
   docker compose up --build
   ```

   (`-v` deletes existing user/leaderboard data — not an issue at this stage
   of development.)

In short: if you see a CORS error in the browser console but `curl`/DevTools
show correct CORS headers, the problem is most likely not CORS — look for the
real 500/exception with `docker compose logs -f api`.

### Conversation memory: every room visit starts fresh

Team decision (see the Zehra/Sümeyra discussion): vocabulary progress
(`vocabulary_progress`) and extractor analytics (`learning_extraction_events`,
`grammar_usage_stats` etc.) are **persistent** — these are already DB tables
keyed by `user_id`, independent of the session, nothing is deleted. The raw
conversation history with an NPC, however, should **not** be persistent: on
every (re-)entry to a room, the NPC should behave as if meeting the player
for the first time.

The real cause preventing this wasn't CORS/backend, it was in the game
client: `RoomScene`/`LibraryScene` are created by Phaser exactly **once** for
the whole game session (`scene.start()` doesn't destroy the old scene, it
just stops and restarts it), so the `private readonly api = new
PraglishApiClient(...)` field and its cached `session_id` stayed **the same**
every time you re-entered the room. Result: what was said to Lina on the
first library visit kept being appended to the same `session_id`/
`dialogue_history` after leaving and re-entering the library (changing maps
"not deleting" it meant this) — even though old messages weren't visible in
the UI (the panel is rendered from scratch on every `create()`), the real
history sent to the NPC kept growing as before.

Fix: `PraglishApiClient.resetSession()` was added (it only forgets the cached
`session_id`, it keeps `userId` — i.e. vocabulary/coin progress). Both scenes
now call this when leaving the room
(`this.events.once(Phaser.Scenes.Events.SHUTDOWN, ...)`), so the next entry
automatically starts with a new `/api/session/start` + empty
`dialogue_history`. Old session/dialogue rows aren't deleted from the DB
(they're just no longer read) — this can be handled later with a separate
cleanup/archiving job if desired, they're harmless for now.

That fix on its own introduced a small follow-on UX problem: since the chat
panel is also rebuilt from scratch on every `create()`, resetting the backend
session silently emptied the **visible** chat bubbles too when you left and
re-entered a room within the same page load — even though the reset was only
meant to give the NPC a fresh context, not to make it look like the player's
own messages had vanished. Fixed with `game/src/services/RoleplayMemory.ts`:
a page-lifetime-only (not `localStorage`) in-memory transcript, kept per
room, that repopulates the panel's bubbles on entry
(`restoreDialogueMessages()`) independently of what's actually sent to the
backend. This memory — and every cached session — is fully cleared only when
returning to the main menu (`MenuScene.create()` calls
`PraglishApiClient.resetAllSessions()` + `clearRememberedDialogues()`), so a
genuinely fresh start happens between separate play sessions, not on every
single re-entry. Separately, click-to-scroll up/down arrow buttons
(`game/src/ui/DialogueScrollControls.ts`) were added to the dialogue and
vocabulary panels for easier navigation of a long chat log without relying
on the mouse wheel or dragging a scrollbar.

### Response time (Gemini/Groq "thinking" time)

One player turn (`POST /api/session/{id}/turn`) makes **two sequential** LLM
calls in the `ai` service: first the Language Evaluator (`P(U|C,S,L,G)`
estimate), then, depending on the result, either the Correction Module or the
NPC — the second call depends on the first one's result so it can't be
parallelized (this is Sümeyra's own pipeline design, we didn't change it).
Extractor calls already run in the background via `background_tasks`, they
don't make the player wait (`api/routes/turn.py`) — that wasn't the source of
the slowness.

Without breaking the pipeline, we did three things to speed up the existing
two-call flow:

1. **A faster model for evaluator + correction.** Both produce short
   structured outputs (a percentage + one sentence, or a corrected sentence +
   a short coach note) — they don't need a large/creative model like NPC
   dialogue does. On the Groq side we switched the default from
   `llama-3.3-70b-versatile` to Groq's "instant" (low-latency, small) model
   `llama-3.1-8b-instant` — configurable separately via
   `GROQ_EVALUATOR_MODEL` / `GROQ_CORRECTION_MODEL`. NPC dialogue
   (`GROQ_MODEL`) stays on the large model for character quality. We didn't
   force a change on the Gemini side since we don't know which model is
   lighter there; you can set `GEMINI_EVALUATOR_MODEL` yourself if you want
   (empty means it falls back to `GEMINI_MODEL`, i.e. the old behavior).
2. **Filtered full conversation history.** All accepted user messages and
   real NPC replies from the current room visit are sent to the
   evaluator + NPC/correction calls. Rejected user sentences and coach
   corrections aren't included in context; no numeric limit is applied to
   the history.
3. **Shorter NPC replies.** A "1-2 short sentences, 3 at most" constraint was
   added to the system prompt in `ai/modules/npc.py` — this is more natural
   for in-game dialogue (it's a conversation, not an essay), and it also
   shortens the model's completion time since it produces fewer output
   tokens.

None of the above changes the pipeline's steps (evaluator → correction/npc →
extractor), only which model is used and how much context it's given. If it
still feels slow, the next step is probably measuring network/Docker Desktop
latency (e.g. comparing when a turn reaches the `ai` container vs. when it
responds with `docker compose logs -f ai`).

### Parallel work model

`api/services/ai_client.py` has a `USE_MOCK_AI` environment variable:
- `true`: develop the session/DB flow with a fixed/fake reply, without an
  API key.
- `false` (default): makes a real HTTP request to the `ai` container.

Sümeyra can bring up the `ai` service on its own with `docker compose up ai`
and test `POST http://localhost:8001/evaluate-and-respond` independently
with Postman/curl without waiting on `api` at all.

### Sahneyi Seslendir (Dub the Scene)

A separate practice mode alongside the roleplay rooms: `game/src/scenes/DubScene.ts`
on the client, `api/routes/dub.py` on the backend.

Pick a movie scene and a character, then go line by line: watch/listen to the
reference clip for the other character's lines, and for your own character's
lines, record yourself repeating it. The recording is sent as
`multipart/form-data` to `POST /api/dub/scripts/{script_id}/lines/{line_id}/score`,
which transcribes it through the same active STT provider (Gemini or Groq,
`verbatim` mode) used everywhere else, then compares it word by word against
the expected line with `difflib.SequenceMatcher` (so a skipped/extra word
doesn't throw off the alignment of the rest, unlike a plain
`expected[i] == actual[i]` check) and returns a per-word correct/incorrect
list plus an overall accuracy percentage. Feedback is shown as a subtitle-style
overlay at the bottom of the video.

`GET /api/dub/scripts` returns the available scenes sorted by an
auto-computed difficulty level (`_compute_difficulty_score` in `dub.py`,
based on rare-word ratio and average word/line length) — no manual difficulty
tagging needed when a new script is added.

Progress (average accuracy per script/character) is kept in the browser's
`localStorage` (`praglish.dub.completion.v1`), not in the backend/DB, since
it's per-device practice progress rather than an account-level stat. A book
icon next to the existing "?" help icon on the script-select screen opens an
"Ilerleme Defteri" (progress journal) screen, reusing the same "paper book"
visual shell as the general Progress Dashboard below, showing an overview
plus per-script/character progress bars.

Note on size: the video/audio clips for this feature are by far the heaviest
thing in the repo (see "Repo size" below). They are loaded lazily — only the
selected script/character's clip is ever requested by the browser, there's
no upfront Phaser preload of the whole set.

### Progress Dashboard ("PRAGLISH JOURNAL")

A general, cross-feature progress dashboard (`game/src/scenes/DashboardScene.ts`),
opened with the **P** key from `RoomScene`, `LibraryScene`, or `StudioScene`.
Backend: `POST /api/analytics/dashboard` with `{username, password}` — registers a new
user automatically if the username doesn't exist yet (same simple auth model
as `/api/session/start`), otherwise verifies the password; returns profile
(XP/coins/level), a 7-day activity chart, room visit counts, grammar topic
mastery, vocabulary level/error stats, and the idiom collection
(`api/services/dashboard_analytics.py` builds this from the analytics tables
listed below). Four tabs: Profile, Grammar, Words, Idioms.

Dub the Scene's own "Ilerleme Defteri" screen intentionally does **not**
reuse this dashboard scene directly — its progress data (per-script/character
accuracy) doesn't fit this dashboard's schema — but it does reuse the same
visual CSS classes (`.paper-book`, `.paper-page`, `.paper-stat-grid`,
`.paper-meter`, etc.) so both feel like the same "journal".

### Tests

- `api/tests/`, `ai/tests/` — existing Python unit tests (`unittest`, no
  `pytest` dependency needed), run inside their respective containers:

  ```powershell
  docker compose exec api python -m unittest discover -s tests
  docker compose exec ai python -m unittest discover -s tests
  ```

- `game/src/engine/__tests__/*.test.ts` — Vitest unit tests for the pure
  client-side engine logic (isometric math, depth sorting, A* pathfinding,
  direction resolving — none of it depends on Phaser/canvas). Run with:

  ```powershell
  docker compose exec game npm test
  ```

  If `docker compose build game` fails with an `npm ci` lockfile-sync error
  after a new dependency was added to `game/package.json`, regenerate
  `game/package-lock.json` once against the real `game/` folder before
  building:

  ```powershell
  docker run --rm -v "${PWD}\game:/app" -w /app node:24-alpine npm install
  ```

- `api/tests/test_integration_smoke.py` — end-to-end smoke test: brings no
  extra dependency of its own (pure stdlib), but expects **all three
  services + the DB already running** (`docker compose up -d --build`), then
  drives a real player turn through actual HTTP calls: health-checks
  `api`/`ai`/`game`, starts a session, plays two turns in a row (checking the
  second one correctly reads back the first from the DB), and confirms the
  dashboard analytics picked the turns up. This is the check to run once
  before a demo, since with 3 services + a DB it's easy for one wire to come
  loose without any single unit test noticing. Unlike the unit tests above,
  it works whether `USE_MOCK_AI` is `true` or `false`. Run it either with a
  local Python 3.10+ (no install needed):

  ```powershell
  python api/tests/test_integration_smoke.py
  ```

  or, if you don't have Python locally, from inside the already-running
  `api` container (point it at the other two services by their
  docker-compose network names):

  ```powershell
  docker compose exec api sh -c "SMOKE_AI_URL=http://ai:8001 SMOKE_GAME_URL=http://game:5173 python tests/test_integration_smoke.py"
  ```

### Available endpoints (api service)

| Endpoint | Description |
|---|---|
| `POST /api/session/start` | `{username, password, location, npc_role}` — register/login + start a new game session, loads `scenario_state` from `game_data/scenarios/{location}.json` |
| `POST /api/session/{session_id}/turn` | `{user_text}` — evaluates the sentence; saves every real NPC message and only accepted user messages, gives an unsaved `coach` reply on a rejected turn |
| `GET /api/user/{user_id}` | The user's coin/XP info |
| `GET /api/leaderboard/` | Top 10 users by XP |
| `POST /api/vocabulary/submit` | `{user_id, location, concept, word}` — awards a coin if the word/synonym matches and hasn't already been earned |
| `GET /api/vocabulary/progress/{user_id}/{location}` | The user's vocabulary progress in that room |
| `POST /api/speech/stt` | `multipart/form-data`, field name `audio` (+ optional `language_code` query) — proxies to the active provider (Gemini or Groq) in the `ai` service, returns `{text, language_code, mode, model, latency_ms}` |
| `POST /api/speech/tts` | `{text, voice?, style?}` — proxies to the active provider (Gemini or Groq) in the `ai` service, returns raw `audio/wav` bytes |
| `POST /api/analytics/dashboard` | `{username, password}` — register/login, returns the user's profile/XP/coins, weekly activity, room visits, and grammar/vocabulary/idiom stats (for PRAGLISH JOURNAL) |
| `GET /api/dub/scripts` | Returns the Dub-the-Scene scripts, sorted by difficulty level |
| `POST /api/dub/scripts/{script_id}/lines/{line_id}/score` | `multipart/form-data`, field name `audio` — sends the recording to the active STT provider, compares it word by word against the expected line, returns an accuracy percentage plus a per-word correct/incorrect list |

### Learning analytics tables

- `learning_extraction_events` — raw extractor result for accepted sentences;
  a rejected sentence's text isn't saved, only aggregate error counters
  increase
- `grammar_usage_stats` — user + correct/incorrect + 1–50 topic counters
- `vocabulary_level_stats` — user + A1–C2 counters, correct usage only
- `vocabulary_error_type_stats` — user + spelling, word_form, lexical_choice,
  sense, or collocation counters for incorrect usage
- `idiom_usage_stats` — first/last use and repeat count per normalized idiom

### Static game data (`api/game_data/`)

- `scenarios/bakery.json`, `scenarios/library.json` — the **active** rooms
  (`"status": "active"`). These are the only two rooms with a real Tiled map,
  assets, and NPC (Maya / Lina) in the game client;
  `game/src/scenes/RoomScene.ts` (bakery) and `LibraryScene.ts` (library).
- `scenarios/cafe.json`, `scenarios/hospital.json`, `scenarios/school.json` —
  **planned** rooms (`"status": "planned_no_assets_yet"`). These three rooms
  were in the initial MVP design, but no suitable assets were found for the
  game client; there is no corresponding Scene/map in `game/` for them, so
  the player currently can't enter these rooms at all. The files were kept so
  the scenario design isn't lost. Once assets are found: set `status` to
  `"active"`, add `vocabulary/{location}.json`, add the NPC identity to
  `NPC_PROFILES` in `ai/main.py`, and add a mock reply to `MOCK_RESPONSES` in
  `api/services/ai_client.py`.
- `vocabulary/bakery.json`, `vocabulary/library.json` — the vocabulary/synonym
  economy for the active rooms (say/write the object's name → earn a coin,
  reward stops once the synonyms for that object run out). Previously only
  `vocabulary/cafe.json` existed; since bakery and library are the rooms that
  actually work in the game, these two had no vocabulary at all and
  `/api/vocabulary/*` endpoints kept returning empty/404 for them. They're
  now filled in based on the real asset list (bread, croissant, book, chair,
  etc.).
- `vocabulary/cafe.json` — in the same planned state as the `cafe` scenario,
  effectively unused since it has no counterpart in the game client.
  `hospital.json`/`school.json` still have no vocabulary file; if not added,
  `VocabularyEngine` silently returns an empty concept list, no error.

### Done / remaining work

**Done, tested:**
- Docker/Compose (game + api + ai + db)
- DB models (User, GameSession, Dialogue, VocabularyProgress)
- Push-to-talk STT (`verbatim`) and WAV TTS endpoints (Gemini + Groq)
- Auth (simple username+password, hackathon-MVP level)
- Session start + turn flow (save → evaluate → reward → scenario check)
- Reward engine, leaderboard, vocabulary system
- Phaser game client, bakery/library maps, movement and collision
- Maya and Lina chat panels wired into the session/turn flow
- `vocabulary/bakery.json` and `vocabulary/library.json` added (previously
  only cafe had one, but bakery/library are the rooms that actually work in
  the game); `cafe`/`hospital`/`school` scenarios marked
  `"status": "planned_no_assets_yet"`; `ai_client.py`'s mock reply is now
  correct for bakery too (it used to return the coffee-shop reply for every
  room)
- Microphone button (🎤) in the game client → `/api/speech/stt` → turn flow,
  and the NPC's reply played back from `/api/speech/tts` — in both bakery and
  library. The `api` service proxies to `ai` (`api/routes/speech.py`), so the
  game only needs one base URL and `ai/main.py` didn't need CORS added
  separately. `game/scripts/mock-api.mjs` was also updated to support these
  two endpoints (fixed text / silent WAV).
- Every AI call in the `ai` service (evaluator, correction, extractors, NPC
  dialogue, STT, TTS) can now run on either Gemini **or** Groq (shared
  `Protocol`s in `ai/modules/*.py` + `Groq*Provider` classes, the choice is
  made in `ai/main.py > _active_ai_provider()` based on which API key is
  filled in) — if one provider has an outage, swapping the key in `.env` and
  restarting only the `ai` container is enough.
- "Sahneyi Seslendir" (Dub the Scene) practice mode: pick a script/character,
  watch/record line by line, get word-level accuracy feedback, own progress
  journal reusing the general dashboard's visual style.
- General progress dashboard ("PRAGLISH JOURNAL"): profile/XP, weekly
  activity, grammar/vocabulary/idiom stats, opened with the P key.
- Client-side chat continuity (`RoleplayMemory.ts`) and scroll controls for
  the dialogue/vocabulary panels.
- Vitest unit tests for the game client's engine logic; existing Python unit
  tests for `api`/`ai`; an end-to-end smoke test (`api/tests/test_integration_smoke.py`)
  that drives a real turn across all three services + the DB.

**Waiting / stretch goal:**
- Streaming STT/TTS and letting the player interrupt the NPC while it's
  talking (currently push-to-talk: record → stop → send, single file based)
- Automatic request-level failover between Gemini and Groq (currently only
  Gemini is used if both are configured; for real-time switching, a
  try/except + fallback-to-second-provider could be added to each
  `get_*_provider()` function)

### Next steps

- [ ] Restore the active session and conversation history when the game is reopened
- [ ] Add a data retention/cleanup policy for guest conversations

---

<a id="turkce"></a>
## Türkçe

### Oyun istemcisi

Çalışan Phaser MVP'si `game/` klasöründedir. İzometrik fırın ve kütüphane
haritalarını render eder; tıkla-yürü, A* pathfinding, mobilya çarpışmaları ve
AI destekli Maya ile Lina NPC'lerini içerir.

```bash
cd game
npm install
npm run dev
```

Oyun: http://localhost:5173

Ayrıntılar için `game/README.md` dosyasına bakın.

### Mimari

- **api/** (Zehra) — FastAPI, session/scenario/vocabulary/ödül mantığı, DB. Hafif bağımlılıklar.
- **ai/** (Sümeyra) — STT, TTS, Language Evaluator, NPC Engine. Ağır ML bağımlılıkları.
- **shared/schemas.py** — İkisinin de kullandığı ortak Pydantic modelleri. Bu dosyayı
  değiştirmeden önce birbirinize haber verin, çünkü her iki container da bunu kullanıyor.

### Çalıştırma

```bash
cp .env.example .env   # GEMINI_API_KEY'i (veya GROQ_API_KEY'i) doldurun
docker compose up --build
```

#### AI sağlayıcısı: Gemini + Groq (yedeklilik)

`ai` servisindeki **her** AI çağrısı (dil değerlendirme, correction coach,
extractor'lar, NPC diyaloğu, STT, TTS) tek bir sağlayıcıya değil, ortak bir
Protocol arayüzüne bağlıdır (`ai/modules/*.py` içindeki `*Provider`
sınıfları). Bunun sayesinde aynı işi yapan iki farklı somut uygulama var:
`Gemini*Provider` ve `Groq*Provider`. Hangisinin kullanılacağına
`ai/main.py > _active_ai_provider()` şu kurala göre karar verir:

- `.env`'de `GEMINI_API_KEY` doluysa → Gemini kullanılır (bugüne kadarki
  varsayılan davranış, hiçbir şey değişmedi).
- `GEMINI_API_KEY` boş/silinmiş ve `GROQ_API_KEY` doluysa → **tüm** AI
  çağrıları otomatik olarak Groq'a döner.
- İkisi de boşsa ilk AI çağrısında (health check'te değil) açık bir hata
  alırsınız: `"No AI provider is configured..."`.

Yani Gemini tarafında bir kesinti/limit sorunu yaşanırsa, `.env`'de
`GEMINI_API_KEY` satırını silip (veya boşaltıp) `GROQ_API_KEY`'i doldurup
`docker compose up --build ai` ile yalnızca `ai` container'ını yeniden
başlatmak yeterli - `api` ve `game` tarafında hiçbir değişiklik gerekmez,
ikisi de `ai` servisini aynı `/evaluate-and-respond`, `/stt`, `/tts` vb.
uçlarla çağırmaya devam eder.

Groq tarafı `groq` SDK'sı yerine Groq'un OpenAI-uyumlu REST uçlarına
doğrudan `httpx` ile gider (`ai/modules/groq_client.py`), böylece ekstra bir
bağımlılık eklemeye gerek kalmadı:

| Yetenek | Gemini | Groq |
|---|---|---|
| Dil değerlendirme / correction / extractor (yapılandırılmış JSON) | `gemini-3.5-flash-lite`, `response_json_schema` | `llama-3.3-70b-versatile`, JSON mode (`GROQ_MODEL`) |
| NPC diyaloğu | `gemini-3.5-flash-lite` | `llama-3.3-70b-versatile` (`GROQ_MODEL`) |
| STT | `gemini-3.5-transcribe`, verbatim mod | `whisper-large-v3-turbo` (`GROQ_STT_MODEL`) - Whisper zaten harfiyen yazar, dilbilgisini düzeltmez |
| TTS | `gemini-3.1-flash-tts-preview`, 24 kHz WAV | `canopylabs/orpheus-v1-english` (`GROQ_TTS_MODEL`), zaten WAV döner |

TTS harcamasını ayrı bir Gemini projesinde tutmak için isteğe bağlı
`GEMINI_TTS_API_KEY` tanımlanabilir. Doluysa yalnızca TTS bu anahtarı
kullanır; boşsa mevcut kurulumları bozmamak için `GEMINI_API_KEY` kullanılır.

Not: Gemini ve Groq'un ses isimleri farklı (`Kore` vs. `hannah`/`troy`/...).
`GroqTextToSpeechProvider` tanımadığı bir ses adı görürse (ör. varsayılan
`Kore`) sessizce kendi varsayılanına düşer, hata vermez - oyun tarafının
hangi sağlayıcının aktif olduğunu bilmesine gerek yok.

Bu, **çalışma zamanında** istek başına otomatik failover değildir (yani
Gemini bir istekte patlarsa o istek anında Groq'a düşmez) - hangi anahtar
`.env`'de dolu ise o sağlayıcı kullanılır. İki anahtarı da girip gerçek
istek-bazlı failover istenirse bu kolay bir sonraki adım.

#### Windows'ta tam sistemi çalıştırma

Yeni bir PowerShell penceresinde repoyu klonlayıp proje klasörüne girin:

```powershell
git clone https://github.com/sumeyraKoc/praglish.git
cd praglish
Copy-Item .env.example .env
# .env içindeki GEMINI_API_KEY (veya GROQ_API_KEY) değerini kendi anahtarınızla değiştirin.
docker compose up --build -d
docker compose ps
```

`db` satırı `healthy`; `api`, `ai` ve `game` satırları `Up`
görünmelidir. Tüm servislerin loglarını izlemek için:

```powershell
docker compose logs -f game api ai db
```

Oyun da Compose tarafından Node.js 24 container'ında başlatılır; bilgisayara
ayrıca Node.js veya npm kurmak gerekmez. `http://localhost:5173` adresini açın.
Maya ve Lina konuşma istemcileri varsayılan olarak `http://localhost:8000`
adresindeki gerçek API'yi kullanır. Gemini/Groq anahtarı olmadan yalnızca
akışı denemek için `.env` dosyasına `USE_MOCK_AI=true` eklenebilir.

Yalnızca container'ları durdurmak için:

```powershell
docker compose down
```

PostgreSQL verisini de silerek tamamen sıfırlamak için ancak bilinçli olarak
`docker compose down -v` kullanın.

- api → http://localhost:8000/docs
- ai  → http://localhost:8001/docs (`GET /health` aktif sağlayıcıyı da döner: `{"ai_provider": "gemini" | "groq" | "unconfigured"}`)

#### Terminalden AI pipeline demosu

Terminal pipeline demosu text-in/text-out calisir (`ai/cli.py`, su an
sadece Gemini ile calisiyor). AI servisindeki gercek STT/TTS endpoint'leri
ayri olarak kullanilir. Language Evaluator, `P(U | C,S,L,G)` icin baglamsal
bir makulluk yuzdesi tahmin eder. Ayarlanabilir threshold'u gecemeyen cumle
Correction Module'a, kabul edilen cumle ise NPC'ye gider:

```bash
pip install -r ai/requirements.txt
python -m ai.cli
```

NPC yalnizca Language Evaluator tarafindan kabul edilen kullanici cumlelerini
ve kendi cevaplarini konusma gecmisinde tutar.

Her cumle evaluator kararindan sonra iki extractor'dan birine gider:

- `CorrectExtractor`: dogru kullanilan gramer konularini, isim/sifat CEFR
  seviyelerini ve idiomlari cikarir.
- `IncorrectExtractor`: yalnizca somut hata bulunan gramer, vocabulary ve idiom
  kategorilerini cikarir.

AI servisinde iki tamamen ayri extractor endpoint'i vardir:

- `POST /extract/correct` yalnizca `ai/prompts/correct_extractor.txt` prompt'unu,
- `POST /extract/incorrect` yalnizca `ai/prompts/incorrect_extractor.txt` prompt'unu kullanir.

Her ikisinin de request body'si yalnizca o anki cumledir:

```json
{"utterance": "Could I get a coffee, please?"}
```

Context, rol, hedef, konusma gecmisi ve evaluator aciklamasi extractor'a
gonderilmez. API servisi yapilandirilmis sonucu PostgreSQL'deki ham event tablosuna ve ayri
`correct`/`incorrect` sayaclarina atomik olarak kaydeder. Ayni `dialogue_id`
tekrar islenirse sayaclar ikinci kez artmaz.

#### Correction coach

Evaluator bir cumleyi reddettiginde correction modulu aktif AI saglayicisina
(Gemini veya Groq) yalnizca reddedilen son cumleyi ve evaluator'a verilen
filtrelenmis dialogue history'yi gonderir. Cikti, duzeltilmis cumle ile kisa
bir coach aciklamasini ayri alanlarda tasir. Bu akis `python -m ai.cli` icinde
otomatik calisir. Modulu AI servisi uzerinden bagimsiz denemek icin:

```powershell
$body = @{
  utterance = "I go to school yesterday."
  dialogue_history = @(
    @{ speaker = "npc"; text = "Where did you go yesterday?" }
  )
} | ConvertTo-Json -Depth 4

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8001/correct" `
  -ContentType "application/json" `
  -Body $body
```

Oyunda reddedilen bir cumlede ayni koc mesaji, NPC adiyla degil `COACH`
etiketiyle gosterilir. Incorrect cumle ve coach mesaji dialogue history'ye
kaydedilmez.

#### STT/TTS ilk denemesi

AI servisinin `POST /stt` endpoint'i kisa push-to-talk kayitlarini aktif
saglayiciya (Gemini `gemini-3.5-transcribe` veya Groq `whisper-large-v3-turbo`)
gonderir. Transkripsiyon her zaman `verbatim` modundadir; boylece ogrencinin
gramer hatalari ve duraksamalari evaluator'a ulasmadan temizlenmez.

```bash
curl -X POST "http://localhost:8001/stt?language_code=en-US&custom_vocabulary=espresso,latte" \
  -F "audio=@sample.wav"
```

`POST /tts` metni aktif saglayicinin TTS'i ile WAV'a cevirir (Gemini: 24 kHz
mono; Groq: Orpheus, zaten WAV):

```bash
curl -X POST http://localhost:8001/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Certainly. Would you like milk?","voice":"Kore"}' \
  --output npc.wav
```

Ilk prototip dosya/tek cumle tabanlidir. Streaming ve konusma kesme destegi
push-to-talk akisi dogrulandiktan sonra eklenecektir.

Kabul esigi `.env` icinden degistirilebilir; ornek deger:

```env
LANGUAGE_ACCEPTANCE_THRESHOLD=50
```

#### Oyunda konuşarak pratik (mikrofon → STT → tur → TTS)

Oyun istemcisi artık `ai` servisinin `/stt`/`/tts` uçlarını **doğrudan** çağırmaz;
her ikisi de `api` servisi üzerinden proxy'lenir (`POST /api/speech/stt`,
`POST /api/speech/tts` — bkz. `api/routes/speech.py` + `api/services/ai_client.py`).
Bu tercih bilinçli: oyun tarafı (`PraglishApiClient.ts`) tek bir base URL
(`http://localhost:8000`) bilir, CORS zaten sadece `api`'de tanımlı, ve
`ai/main.py`'a ayrıca CORS eklemek gerekmiyor.

Akış: Maya/Lina diyalog panelindeki 🎤 butonuna basınca `MediaRecorder` ile
tarayıcıda kayıt başlar (tekrar basınca durur) → kayıt `/api/speech/stt`'ye
gönderilir → dönen **verbatim** metin (dilbilgisi hataları düzeltilmez) normal
yazılı mesaj gibi `/api/session/{id}/turn`'e gider, yani kabul/düzeltme/ödül
mantığı yazarak da söyleyerek de aynı şekilde çalışır → NPC'nin cevabı
`/api/speech/tts`'ten sesli olarak çalınır (metin zaten panelde de görünür,
ses çalma başarısız olursa — mikrofon izni yok, tarayıcı otomatik-oynatmayı
engelledi, `ai` container kapalı — sessizce yutulur).

Gerçek transkripsiyon/sentez için `ai` container'ının **`GEMINI_API_KEY` veya
`GROQ_API_KEY` ile** ayakta olması gerekir; `docker compose up` bunu zaten
başlatıyor. `npm run dev:mock-api` ile (Docker'sız, sadece oyun) test ederken
`game/scripts/mock-api.mjs` artık `/api/speech/stt`'ye sabit bir örnek cümle,
`/api/speech/tts`'e ise geçerli ama **sessiz** bir WAV döner — amaç ses
kalitesini değil, mikrofon → metin → tur → ses oynatma akışının uçtan uca
kopmadan çalıştığını görebilmenizdir.

Tarayıcı notu: `getUserMedia` (mikrofon izni) yalnızca "secure context"te
çalışır — `http://localhost` bunun istisnası olduğu için geliştirmede sorun
yok, ama demo günü oyunu `http://` ile başka bir makineden/URL'den açarsanız
mikrofon izni tarayıcı tarafından reddedilir; o durumda HTTPS gerekir.

Şema değişikliği olduğunda (örn. `models/models.py`'de yeni bir **alan** eklendiğinde)
`create_all()` var olan tabloları güncellemez — bu durumda:
```bash
docker compose down -v
docker compose up --build
```
Yeni bir **tablo** eklenmesi bu sıfırlamayı gerektirmez, `create_all()` sadece eksik
tabloları oluşturur.

### Sık karşılaşılan hatalar

#### "Backend is unavailable at localhost:8000" / tarayıcıda CORS hatası, ama curl/DevTools CORS'un doğru olduğunu gösteriyor

Bu proje geliştirilirken tam olarak bu senaryo yaşandı ve gerçek sebebi CORS
**değildi**: `api` container'ının Postgres'i ilk kez ayağa kaldırdığı andaki
`User` modeliyle, o andan sonra modele eklenen `password_hash` alanı
arasında bir uyuşmazlık vardı — `Base.metadata.create_all()` **var olan**
tabloları güncellemez (yalnızca eksik tabloları oluşturur, bkz. yukarıdaki
"şema değişikliği" notu), yani eski bir `pgdata` volume'unda `users`
tablosunda `password_hash` kolonu hiç yoktu. Bu da `/api/session/start`'ta
gerçek bir SQL hatasıyla 500 dönmesine yol açıyordu:

```
psycopg2.errors.UndefinedColumn: column users.password_hash does not exist
```

Buradaki asıl kafa karıştırıcı kısım şu: bir route içinde `HTTPException`
olmayan beklenmeyen bir hata patladığında, Starlette'in bunu yakalayan
`ServerErrorMiddleware`'i `CORSMiddleware`'in **dışında** oturuyor — yani
sonuçta dönen 500 cevabına CORS header'ları hiç eklenmiyor. Tarayıcı da
gerçek 500'ü değil, "No 'Access-Control-Allow-Origin' header is present"
şeklinde bir CORS hatası gösteriyor; halbuki CORS ayarının kendisi (bkz.
`api/main.py`'deki `CORSMiddleware`) tamamen doğruydu — `curl` ve DevTools
Network sekmesinde `OPTIONS` preflight'ının 200 dönmesi de bu yüzdendi. Bu
sorunu iki katmanda çözdük:

1. **Kalıcı kod düzeltmesi**: `api/main.py`'a global bir
   `@app.exception_handler(Exception)` eklendi. Bu, beklenmeyen hataları
   FastAPI'nin normal (CORS header'larını doğru ekleyen) hata işleme
   katmanına sokuyor — böylece bundan sonra gerçekten alakasız bir 500 hatası
   olsa bile tarayıcıda "CORS hatası" gibi görünüp saatlerce yanlış yöne
   baktırmıyor, gerçek hata (`{"detail": "Internal server error"}`, log'da
   tam traceback ile) görünüyor.
2. **Bu spesifik durumun düzeltmesi**: modelin (`api/models/models.py`)
   beklediği şemayla Postgres'teki gerçek tabloyu eşitlemek için volume'u
   sıfırlayın:

   ```bash
   docker compose down -v
   docker compose up --build
   ```

   (`-v` mevcut kullanıcı/leaderboard verisini siler — hackathon
   geliştirme aşamasında sorun değil.)

Kısacası: tarayıcı konsolunda CORS hatası görüp `curl`/DevTools'ta CORS
header'larının doğru geldiğini de görüyorsanız, sorun büyük ihtimalle CORS
değil — `docker compose logs -f api` ile asıl 500/exception'ı arayın.

### Konuşma hafızası: her oda ziyareti sıfırdan başlar

Ekip kararı (bkz. Zehra/Sümeyra sohbeti): kelime ilerlemesi (`vocabulary_progress`)
ve extractor analitiği (`learning_extraction_events`, `grammar_usage_stats` vb.)
**kalıcı** — bunlar zaten `user_id`'ye bağlı, session'dan bağımsız DB
tabloları, hiçbir şey silinmiyor. NPC ile yapılan çiğ konuşma geçmişi ise
**kalıcı olmamalı**: her odaya (yeniden) girişte NPC oyuncuyu ilk defa
görüyormuş gibi başlamalı.

Bunu engelleyen gerçek sebep CORS/backend değil, oyun istemcisindeydi:
`RoomScene`/`LibraryScene` Phaser tarafından oyun boyunca **tek bir kez**
oluşturulur (`scene.start()` eski sahneyi yok etmez, sadece durdurup yeniden
başlatır), yani `private readonly api = new PraglishApiClient(...)` alanı ve
onun içindeki önbelleklenmiş `session_id` odaya her dönüşte **aynı** kalıyordu.
Sonuç: kütüphaneye ilk girişte Lina ile konuşulanlar, oradan ayrılıp
tekrar kütüphaneye girildiğinde hâlâ aynı `session_id`/`dialogue_history`'ye
ekleniyordu (harita değiştirince "silinmiyor" demek buydu) — arayüzde eski
mesajlar görünmese de (panel her `create()`'de sıfırdan render ediliyor),
NPC'ye gönderilen gerçek geçmiş eskisi gibi büyümeye devam ediyordu.

Düzeltme: `PraglishApiClient.resetSession()` eklendi (yalnızca
önbellekteki `session_id`'yi unutur, `userId`'yi — yani kelime/coin
ilerlemesini — korur). Her iki sahne de artık odadan çıkarken
(`this.events.once(Phaser.Scenes.Events.SHUTDOWN, ...)`) bunu çağırıyor,
böylece bir sonraki girişte otomatik olarak yeni bir `/api/session/start` +
boş `dialogue_history` ile başlanıyor. Eski session/dialogue satırları
DB'den silinmiyor (sadece artık okunmuyorlar) — istenirse ileride ayrı bir
temizlik/arşivleme işiyle ele alınabilir, şu an için zararsızlar.

Bu düzeltme kendi başına küçük bir yan etki doğurdu: diyalog paneli de her
`create()`'de sıfırdan kurulduğu için, backend oturumunu sıfırlamak aynı
sayfa açıkken bir odadan çıkıp tekrar girildiğinde **görünen** sohbet
balonlarını da sessizce boşaltıyordu — halbuki sıfırlama yalnızca NPC'nin
bağlamını tazelemek içindi, oyuncunun kendi yazdıklarının silinmiş gibi
görünmesi istenmiyordu. `game/src/services/RoleplayMemory.ts` ile düzeltildi:
yalnızca mevcut sayfa ömrü boyunca (localStorage değil) tutulan, oda başına
bir bellek, panel her açıldığında (`restoreDialogueMessages()`) bu bellekten
balonları geri yükler — backend'e gerçekte ne gönderildiğinden bağımsız
olarak. Bu bellek (ve önbellekteki tüm oturumlar) yalnızca ana menüye
dönüldüğünde tamamen temizlenir (`MenuScene.create()` içinde
`PraglishApiClient.resetAllSessions()` + `clearRememberedDialogues()`
çağrılır), yani gerçek bir "sıfırdan başlama" yalnızca ayrı oyun oturumları
arasında olur, her tekil giriş-çıkışta değil. Ayrıca diyalog ve kelime
panellerine, fare tekerleği veya scrollbar'ı sürüklemeye gerek kalmadan uzun
bir sohbet geçmişinde gezinmeyi kolaylaştıran tıkla-kaydır yukarı/aşağı ok
butonları eklendi (`game/src/ui/DialogueScrollControls.ts`).

### Yanıt süresi (Gemini/Groq "düşünme" süresi)

Bir oyuncu turu (`POST /api/session/{id}/turn`) `ai` servisinde **iki ardışık**
LLM çağrısı yapar: önce Language Evaluator (`P(U|C,S,L,G)` tahmini), sonra
sonuca göre ya Correction Module ya da NPC — ikinci çağrı birincinin
sonucuna bağlı olduğu için paralelleştirilemez (bu, Sümeyra'nın tasarladığı
pipeline'ın kendisi, değiştirmedik). Extractor çağrıları zaten
`background_tasks` ile arka planda çalışıyor, oyuncuyu bekletmiyor
(`api/routes/turn.py`) — yavaşlığın kaynağı bu değildi.

Pipeline'ı bozmadan, mevcut iki-çağrılık akışı hızlandırmak için üç şey
yaptık:

1. **Evaluator + correction için daha hızlı model.** İkisi de kısa
   (yüzde + bir cümle, ya da düzeltilmiş cümle + kısa koç notu) yapılandırılmış
   çıktılar üretiyor — NPC diyaloğu gibi büyük/yaratıcı bir modele ihtiyaçları
   yok. Groq tarafında varsayılanı `llama-3.3-70b-versatile`'dan Groq'un
   "instant" (düşük gecikmeli, küçük) modeli `llama-3.1-8b-instant`'a
   çektik — `GROQ_EVALUATOR_MODEL` / `GROQ_CORRECTION_MODEL` ile ayrı ayrı
   ayarlanabilir. NPC diyaloğu (`GROQ_MODEL`) karakter kalitesi için büyük
   modelde kalmaya devam ediyor. Gemini tarafında hangi modelin daha hafif
   olduğunu bilmediğimiz için zorla değiştirmedik; `GEMINI_EVALUATOR_MODEL`
   ile isterseniz siz ayarlayabilirsiniz (boşsa `GEMINI_MODEL` ile aynı,
   yani eski davranış).
2. **Filtrelenmiş tam konuşma geçmişi.** Evaluator + NPC/correction
   çağrılarına mevcut oda ziyaretindeki tüm kabul edilmiş kullanıcı mesajları
   ve gerçek NPC cevapları gönderiliyor. Reddedilmiş kullanıcı cümleleri ile
   koç düzeltmeleri bağlama alınmıyor; geçmişe sayısal bir sınır uygulanmıyor.
3. **Daha kısa NPC cevapları.** `ai/modules/npc.py`'deki sistem promptuna
   "1-2 kısa cümle, en fazla 3" kısıtı eklendi — hem oyun içi diyalog için
   daha doğal (bu bir sohbet, deneme yazısı değil), hem de daha az çıktı
   token'ı ürettiği için modelin bitirme süresini kısaltıyor.

Yukarıdakiler pipeline'ın adımlarını (evaluator → correction/npc → extractor)
DEĞİŞTİRMİYOR, yalnızca hangi modelin kullanıldığını ve modele ne kadar
bağlam gönderildiğini ayarlıyor. Hâlâ yavaş geliyorsa bir sonraki adım
muhtemelen ağ/Docker Desktop tarafındaki gecikmeyi ölçmek olur (ör.
`docker compose logs -f ai` ile bir turun ai container'ına ne zaman ulaştığını
ve ne zaman cevap döndüğünü karşılaştırmak).

### Paralel çalışma modeli

`api/services/ai_client.py` içinde `USE_MOCK_AI` ortam değişkeni var:
- `true`: API anahtarı olmadan sabit/sahte bir
  cevapla session/DB akışını geliştirebilir.
- `false` (varsayılan): gerçek `ai` container'ına HTTP isteği atar.

Sümeyra `ai` servisini `docker compose up ai` ile tek başına ayağa kaldırıp,
`api`'yi hiç beklemeden `POST http://localhost:8001/evaluate-and-respond`'u
Postman/curl ile bağımsız test edebilir.

### Sahneyi Seslendir (Dub the Scene)

Roleplay odalarının yanında ayrı bir pratik modu: istemcide
`game/src/scenes/DubScene.ts`, backend'de `api/routes/dub.py`.

Bir film sahnesi ve bir karakter seçilir, ardından replik replik ilerlenir:
diğer karakterin repliklerinde referans klip izlenir/dinlenir, kendi
karakterinizin repliklerinde ise kendinizi kaydederek tekrar edersiniz. Kayıt
`multipart/form-data` olarak `POST /api/dub/scripts/{script_id}/lines/{line_id}/score`'a
gönderilir; bu uç, kaydı diğer her yerde kullanılan aynı aktif STT
sağlayıcısıyla (Gemini veya Groq, `verbatim` mod) yazıya döker, sonra
beklenen replikle `difflib.SequenceMatcher` kullanarak kelime kelime
karşılaştırır (böylece atlanan/eklenen bir kelime, düz bir
`expected[i] == actual[i]` karşılaştırmasının aksine geri kalan kelimelerin
hizasını bozmaz) ve kelime bazlı doğru/yanlış listesiyle birlikte genel bir
doğruluk yüzdesi döner. Geri bildirim, videonun altında altyazı tarzı bir
katman olarak gösterilir.

`GET /api/dub/scripts`, mevcut sahneleri otomatik hesaplanan bir zorluk
seviyesine göre sıralı döner (`dub.py`'deki `_compute_difficulty_score` —
nadir kelime oranı ve ortalama kelime/replik uzunluğuna dayanır) — yeni bir
senaryo eklendiğinde elle zorluk etiketlemeye gerek yoktur.

İlerleme (senaryo/karakter başına ortalama doğruluk) backend/DB'de değil,
tarayıcının `localStorage`'ında tutulur (`praglish.dub.completion.v1`) —
çünkü bu bir hesap seviyesi istatistikten çok cihaz başına pratik
ilerlemesidir. Senaryo seçim ekranındaki mevcut "?" yardım ikonunun yanına
eklenen bir kitap ikonu, aşağıdaki genel İlerleme Defteri ile aynı "kağıt
defter" görsel kabuğunu yeniden kullanan bir "Ilerleme Defteri" ekranı açar;
bu ekran bir özet ile senaryo/karakter bazlı ilerleme çubukları gösterir.

Boyut notu: bu özelliğin video/ses klipleri repodaki açık ara en ağır şey
(bkz. aşağıda "Repo boyutu"). Bunlar tembel (lazy) yüklenir — tarayıcı yalnızca
seçilen senaryo/karakterin klibini ister, tüm setin Phaser tarafından önceden
yüklenmesi (preload) söz konusu değildir.

### İlerleme Defteri ("PRAGLISH JOURNAL")

Tüm özellikleri kapsayan genel bir ilerleme paneli (`game/src/scenes/DashboardScene.ts`),
`RoomScene`, `LibraryScene` veya `StudioScene`'den **P** tuşuyla açılır.
Backend: `POST /api/analytics/dashboard`, `{username, password}` ile — kullanıcı adı
yoksa otomatik kayıt olur (`/api/session/start` ile aynı basit auth modeli),
varsa şifre doğrulanır; profil (XP/coin/seviye), 7 günlük aktivite grafiği,
oda ziyaret sayıları, gramer konusu hakimiyeti, kelime seviyesi/hata
istatistikleri ve idiom koleksiyonunu döner (`api/services/dashboard_analytics.py`,
aşağıda listelenen analitik tablolarından bunu oluşturur). Dört sekme:
Profile, Grammar, Words, Idioms.

Sahneyi Seslendir'in kendi "Ilerleme Defteri" ekranı bu dashboard sahnesini
bilinçli olarak DOĞRUDAN yeniden kullanmaz — kendi ilerleme verisi (senaryo/
karakter bazlı doğruluk) bu dashboard'un veri şemasına uymaz — ama aynı görsel
CSS sınıflarını (`.paper-book`, `.paper-page`, `.paper-stat-grid`,
`.paper-meter` vb.) paylaşır, böylece ikisi de "aynı defter" hissi verir.

### Testler

- `api/tests/`, `ai/tests/` — mevcut Python birim testleri (`unittest`,
  ayrı bir `pytest` bağımlılığı gerekmez), kendi container'ları içinde
  çalıştırılır:

  ```powershell
  docker compose exec api python -m unittest discover -s tests
  docker compose exec ai python -m unittest discover -s tests
  ```

- `game/src/engine/__tests__/*.test.ts` — istemci tarafındaki saf motor
  mantığı (izometrik matematik, derinlik sıralama, A* pathfinding, yön
  çözümleme — hiçbiri Phaser/canvas'a bağımlı değil) için Vitest birim
  testleri. Çalıştırmak için:

  ```powershell
  docker compose exec game npm test
  ```

  `game/package.json`'a yeni bir bağımlılık eklendikten sonra
  `docker compose build game` bir `npm ci` kilit dosyası uyuşmazlığıyla
  başarısız olursa, build'den önce `game/package-lock.json`'ı gerçek `game/`
  klasörüne karşı bir kere yeniden üretin:

  ```powershell
  docker run --rm -v "${PWD}\game:/app" -w /app node:24-alpine npm install
  ```

- `api/tests/test_integration_smoke.py` — uçtan uca duman testi: kendi
  başına ekstra bağımlılığı yok (saf stdlib), ama **üç servisin + DB'nin
  zaten ayakta olmasını** bekler (`docker compose up -d --build`), sonra
  gerçek HTTP istekleriyle bir oyuncu turunu dener: `api`/`ai`/`game`
  health-check'lerini kontrol eder, bir oturum başlatır, art arda iki tur
  oynar (ikincisinin, DB'den geri okunan ilk turu doğru şekilde kullandığını
  doğrular), ve dashboard analytics'in bu turları yakaladığını teyit eder.
  3 servis + DB'yle hiçbir tekil birim testin fark etmeyeceği bir kablonun
  gevşemesi kolay olduğu için, demodan önce çalıştırılacak asıl kontrol
  budur. Yukarıdaki birim testlerin aksine, `USE_MOCK_AI` ister `true` ister
  `false` olsun çalışır. Yerelde Python 3.10+ varsa (kurulum gerekmez):

  ```powershell
  python api/tests/test_integration_smoke.py
  ```

  Python yoksa, zaten ayakta olan `api` container'ı içinden (diğer iki
  servise docker-compose'un ağ adlarıyla işaret ederek) çalıştırın:

  ```powershell
  docker compose exec api sh -c "SMOKE_AI_URL=http://ai:8001 SMOKE_GAME_URL=http://game:5173 python tests/test_integration_smoke.py"
  ```

### Mevcut endpoint'ler (api servisi)

| Endpoint | Açıklama |
|---|---|
| `POST /api/session/start` | `{username, password, location, npc_role}` — kayıt/giriş + yeni oyun oturumu başlatır, `scenario_state`'i `game_data/scenarios/{location}.json`'dan yükler |
| `POST /api/session/{session_id}/turn` | `{user_text}` — cümleyi değerlendirir; tüm gerçek NPC mesajlarını ve yalnızca kabul edilen kullanıcı mesajlarını kaydeder, reddedilen turda cevabı kaydedilmeyen `coach` verir |
| `GET /api/user/{user_id}` | Kullanıcının coin/xp bilgisi |
| `GET /api/leaderboard/` | XP'ye göre ilk 10 kullanıcı |
| `POST /api/vocabulary/submit` | `{user_id, location, concept, word}` — kelime/eş anlamlı eşleşirse ve daha önce kazanılmadıysa coin verir |
| `GET /api/vocabulary/progress/{user_id}/{location}` | Kullanıcının o odadaki kelime ilerlemesi |
| `POST /api/speech/stt` | `multipart/form-data`, alan adı `audio` (+ opsiyonel `language_code` query) — `ai` servisindeki aktif saglayiciya (Gemini veya Groq) proxy, `{text, language_code, mode, model, latency_ms}` döner |
| `POST /api/speech/tts` | `{text, voice?, style?}` — `ai` servisindeki aktif saglayiciya (Gemini veya Groq) proxy, ham `audio/wav` bayt dizisi döner |
| `POST /api/analytics/dashboard` | `{username, password}` — kayıt/giriş, kullanıcının profil/XP/coin, haftalık aktivite, oda ziyaretleri ve gramer/kelime/idiom istatistiklerini döner (PRAGLISH JOURNAL için) |
| `GET /api/dub/scripts` | Seslendirilebilir sahne senaryolarını, zorluk seviyesine göre sıralı döner |
| `POST /api/dub/scripts/{script_id}/lines/{line_id}/score` | `multipart/form-data`, alan adı `audio` — kaydı aktif STT sağlayıcısına gönderir, beklenen replikle kelime kelime karşılaştırıp doğruluk yüzdesi + kelime bazlı doğru/yanlış listesi döner |

### Learning analytics tablolari

- `learning_extraction_events` — kabul edilen cumleler icin ham extractor sonucu;
  reddedilen cumlenin metni kaydedilmez, yalnizca aggregate hata sayaclari artar
- `grammar_usage_stats` — kullanici + correct/incorrect + 1–50 konu sayaci
- `vocabulary_level_stats` — yalnizca dogru kullanimlar icin kullanici + A1–C2 sayaci
- `vocabulary_error_type_stats` — yanlis kullanimlar icin kullanici + spelling,
  word_form, lexical_choice, sense veya collocation sayaci
- `idiom_usage_stats` — normalize idiom basina ilk/son kullanim ve tekrar sayaci

### Statik oyun verisi (`api/game_data/`)

- `scenarios/bakery.json`, `scenarios/library.json` — **aktif** odalar (`"status": "active"`).
  Oyun istemcisinde gerçek Tiled haritası, asset'i ve NPC'si (Maya / Lina) olan tek iki oda
  bunlar; `game/src/scenes/RoomScene.ts` (bakery) ve `LibraryScene.ts` (library).
- `scenarios/cafe.json`, `scenarios/hospital.json`, `scenarios/school.json` — **planlanan**
  odalar (`"status": "planned_no_assets_yet"`). İlk MVP tasarımında bu üç oda vardı, ama
  oyun istemcisi için uygun asset bulunamadı; `game/` içinde bunlara karşılık gelen bir
  Scene/harita yok, dolayısıyla oyuncu şu an bu odalara hiç giremiyor. Senaryo tasarımını
  kaybetmemek için dosyaları silmedik. Assetleri bulunduğunda: `status`'u `"active"` yapın,
  `vocabulary/{location}.json` ekleyin, `ai/main.py`'deki `NPC_PROFILES`'a NPC kimliğini
  ekleyin ve `api/services/ai_client.py`'deki `MOCK_RESPONSES`'a bir mock cevap ekleyin.
- `vocabulary/bakery.json`, `vocabulary/library.json` — aktif odaların kelime/eş anlamlı
  ekonomisi (obje adını yaz/söyle → coin kazan, eş anlamlılar bitince o obje için ödül
  kesilir). Daha önce yalnızca `vocabulary/cafe.json` vardı; oyunda gerçekten çalışan
  odalar bakery ve library olduğu için bu ikisinde vocabulary hiç yoktu ve
  `/api/vocabulary/*` endpoint'leri bu iki oda için sürekli boş/404 dönüyordu. Artık
  gerçek asset listesine göre (ekmek, kruvasan, kitap, sandalye, vb.) dolduruldu.
- `vocabulary/cafe.json` — `cafe` senaryosu gibi planlanan durumda, oyun istemcisinde
  karşılığı olmadığı için şu an fiilen kullanılmıyor. `hospital.json`/`school.json` için
  vocabulary dosyası hâlâ yok; eklenmezse `VocabularyEngine` sessizce boş concept listesi
  döner, hata vermez.

### Tamamlanan / kalan işler

**Bitti, test edildi:**
- Docker/Compose (game + api + ai + db)
- DB modelleri (User, GameSession, Dialogue, VocabularyProgress)
- Push-to-talk STT (`verbatim`) ve WAV TTS endpoint'leri (Gemini + Groq)
- Auth (basit username+şifre, hackathon MVP seviyesinde)
- Session başlatma + turn akışı (kaydet → değerlendir → ödüllendir → senaryo kontrolü)
- Ödül motoru, leaderboard, vocabulary sistemi
- Phaser oyun istemcisi, fırın/kütüphane haritaları, hareket ve çarpışma
- Maya ve Lina konuşma panellerinin session/turn akışına bağlanması
- `vocabulary/bakery.json` ve `vocabulary/library.json` eklendi (önceden sadece cafe
  vardı, ama oyunda gerçekten çalışan odalar bakery/library'ydi); `cafe`/`hospital`/`school`
  senaryoları `"status": "planned_no_assets_yet"` ile işaretlendi; `ai_client.py`'deki
  mock cevap artık bakery için de doğru (önceden her oda için kahve cevabı dönüyordu)
- Oyun istemcisinde mikrofon butonu (🎤) → `/api/speech/stt` → tur akışı, ve NPC
  cevabının `/api/speech/tts`'ten sesli çalınması — hem bakery hem library'de.
  `api` servisi `ai`'a proxy yapıyor (`api/routes/speech.py`), böylece oyun tek
  bir base URL biliyor ve `ai/main.py`'a ayrıca CORS eklemek gerekmedi.
  `game/scripts/mock-api.mjs` de bu iki uca (sabit metin / sessiz WAV ile) destek
  verecek şekilde güncellendi.
- `ai` servisindeki her AI çağrısı (evaluator, correction, extractor'lar, NPC
  diyaloğu, STT, TTS) artık Gemini **veya** Groq ile çalışabiliyor
  (`ai/modules/*.py` içindeki ortak `Protocol`'ler + `Groq*Provider`
  sınıfları, seçim `ai/main.py > _active_ai_provider()`'da hangi API
  anahtarının dolu olduğuna göre yapılıyor) — sağlayıcılardan biri kesinti
  yaşarsa `.env`'de anahtar değiştirip yalnızca `ai` container'ını yeniden
  başlatmak yeterli.
- "Sahneyi Seslendir" (Dub the Scene) pratik modu: sahne/karakter seç, replik
  replik izle/kaydet, kelime bazlı doğruluk geri bildirimi al, genel
  dashboard'un görsel diliyle uyumlu kendi ilerleme defteri.
- Genel ilerleme paneli ("PRAGLISH JOURNAL"): profil/XP, haftalık aktivite,
  gramer/kelime/idiom istatistikleri, P tuşuyla açılıyor.
- Diyalog/kelime panelleri için istemci tarafı sohbet sürekliliği
  (`RoleplayMemory.ts`) ve kaydırma kontrolleri.
- Oyun istemcisinin motor mantığı için Vitest birim testleri; `api`/`ai`
  için mevcut Python birim testleri; üç servisi + DB'yi birlikte gerçek bir
  turla deneyen uçtan uca duman testi (`api/tests/test_integration_smoke.py`).

**Bekleniyor / stretch goal:**
- Streaming STT/TTS ve oyuncunun NPC konuşurken araya girebilmesi (şu an
  push-to-talk: kaydet → durdur → gönder, tek seferlik dosya tabanlı)
- Gemini/Groq arasında istek bazlı otomatik failover (şu an ikisi de
  yapılandırılmışsa yalnızca Gemini kullanılıyor; gerçek zamanlı geçiş için
  her `get_*_provider()` fonksiyonuna bir try/except + ikinci sağlayıcıya
  düşme mantığı eklenebilir)

### Sıradaki adımlar

- [ ] Aktif session'ı ve konuşma geçmişini oyun yeniden açıldığında geri yükleyin
- [ ] Misafir konuşmaları için veri saklama/temizleme politikası ekleyin
