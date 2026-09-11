# PRAGLISH

> **Unleash your potential with Praglish.**

Praglish is an experience-based English practice game for learners who already
have knowledge of the language but need meaningful opportunities to use it.
Instead of presenting another sequence of lessons, flashcards, or grammar
explanations, Praglish places the player in simulated situations where English
is the tool for completing a task.

## Why Praglish exists

The English-learning market contains many products for reading, listening,
memorizing vocabulary, and studying grammar. Experience-based interaction is
far less common. Learners consume English constantly, yet many rarely speak or
write it in a situation that requires a real response.

Praglish is designed to address that practice gap.

Its purpose is not to teach new theory. Learning new material remains the
learner's responsibility; Praglish helps the learner activate what they already
know. It is a game where accumulated knowledge can be turned into action through
roleplay, decisions, speech, writing, and immediate contextual feedback.

Intermediate learners can usually communicate their basic meaning. Their
biggest problems are not always syntax or semantics: a sentence may be
understandable and technically possible while still not being the most natural
way to express the idea. Native speakers rely on conventional phrases,
collocations, idioms, register, and context-sensitive choices. Praglish
therefore takes a pragmatic approach. It asks not only, “Is this grammatical?”
but also, “Would a person naturally say this here, to this person, for this
purpose?”

Praglish is best suited to learners who already have an English foundation and
want to improve fluency, natural expression, confidence, and active recall.

## Game modes and exercises

Praglish currently contains two playable modes.

### 1. Roleplay

Explore an isometric environment, approach characters and objects, and use
English to complete contextual goals.

#### Active scenarios

| Location | NPC | Goal | Required information |
|---|---|---|---|
| Bakery | Maya, the baker | Buy something from the bakery | Item and quantity |
| Library | Lina, the librarian | Find and borrow a book | Book topic and borrowing intent |

The repository also contains early definitions for a cafe, hospital, and
school. These are planned concepts only and are not currently playable.

#### Roleplay exercises

- **Contextual conversation:** type a response or use push-to-talk speech with
  an AI-powered NPC.
- **Pragmatic evaluation:** each response is evaluated against the location,
  speaker, listener, communicative goal, scenario state, and conversation.
- **Correction coaching:** an unsuitable or unnatural response receives a more
  natural alternative and a short explanation.
- **Scenario completion:** supply the information required by the real-life
  situation through conversation.
- **Object naming:** interact with visible objects and name them in English.
- **Synonym practice:** discover alternatives such as `bookcase` and
  `bookshelf`, or `cookie` and `biscuit`.
- **Speaking practice:** recordings are transcribed verbatim, without silently
  correcting mistakes before evaluation.
- **Listening practice:** NPC and coach responses are synthesized as speech.

Accepted responses award XP and coins. Completing a scenario grants an
additional bonus. Vocabulary rewards are awarded only once per accepted word,
encouraging the player to find more synonyms rather than repeat one answer.

### 2. Listen & Repeat — Dub the Scene

Choose a scene and character, listen to each line, record your own performance,
and receive word-level feedback. At the end, play the complete scene with your
recordings inserted for the selected character.

Scenes are automatically ordered by computed difficulty:

| Level | Scene | Characters | Lines | Difficulty |
|---:|---|---|---:|---:|
| 1 | *Charade* (1963) | Reggie, Bartholomew | 16 | 37/100 |
| 2 | *Gulliver's Travels* (1939) | King Little, King Bombo | 12 | 38/100 |
| 3 | *Night of the Living Dead* (1968) | Barbra, Johnny | 14 | 46/100 |
| 4 | *Superman* (1943) | Henderson, Clark Kent, Lois Lane, Mr. White | 9 | 52/100 |

#### Listen & Repeat exercises

- Choose the character you want to perform.
- Listen to and watch the reference line.
- Repeat the line into the microphone.
- Convert the recording to a verbatim transcript.
- Compare it with the script using sequence-aware, word-level matching.
- Review correct and missed words with an accuracy percentage.
- Replay a line before continuing.
- Play the complete scene with your own recordings.
- Track average accuracy for each scene and character in the dubbing journal.

Dubbing progress is stored in the browser's `localStorage` on the current
device, not in PostgreSQL.

## Main features

- Contextual roleplay and solo scene-dubbing modes
- Isometric Phaser environments with click-to-walk movement, A* pathfinding,
  depth sorting, and collisions
- Typed and microphone-based input
- Verbatim speech-to-text and WAV text-to-speech
- Short, in-character AI NPC responses
- Contextual plausibility scoring rather than grammar-only validation
- Correction coaching for unnatural responses
- Object-based vocabulary and synonym exercises
- XP, coins, levels, scenario bonuses, and a top-ten leaderboard API
- Persistent grammar, vocabulary, idiom, and activity analytics
- A Praglish Journal with profile, grammar, words, and idioms views
- Per-character dubbing progress
- Gemini and Groq implementations behind shared AI interfaces
- A mock roleplay mode for development without paid conversation calls

## How a roleplay turn works

1. The player types a sentence or records one.
2. Speech input is transcribed verbatim.
3. The evaluator estimates how plausible the utterance is in context.
4. If accepted, the NPC answers and the scenario advances.
5. If rejected, the coach supplies a more natural alternative.
6. XP, coins, and activity data are updated.
7. Grammar, vocabulary, and idiom extraction runs in the background.

Rejected sentences and coach corrections are excluded from NPC conversation
memory. Only accepted player turns and genuine NPC replies become context.

## Quick start with Docker

Docker Compose is the recommended setup because it starts PostgreSQL, the API,
the AI service, and the game client together.

### Requirements

- Git
- Docker Desktop with Docker Compose
- A modern browser with microphone support
- A Gemini or Groq API key for real AI and speech features

### 1. Clone the repository

```bash
git clone https://github.com/sumeyraKoc/praglish.git
cd praglish
```

### 2. Create the environment file

macOS or Linux:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Configure one provider in `.env`:

```env
GEMINI_API_KEY=your-real-gemini-key
GROQ_API_KEY=
```

or:

```env
GEMINI_API_KEY=
GROQ_API_KEY=your-real-groq-key
```

Gemini is selected when both keys are present. Restart the AI service after
changing providers. Replace or clear every placeholder value copied from
`.env.example`; an unused placeholder is still a non-empty key. In particular,
leave `GEMINI_TTS_API_KEY` empty unless it contains a real dedicated TTS key.

For roleplay UI development without real conversation calls:

```env
USE_MOCK_AI=true
```

Mock mode returns fixed bakery and library conversation responses. Speech
recognition, speech synthesis, and dubbing scores still need a running AI
service and a real provider key.

### 3. Start the stack

```bash
docker compose up --build -d
docker compose ps
```

Wait until `db` is healthy, then open:

- Game: <http://localhost:5173>
- API docs: <http://localhost:8000/docs>
- AI service docs: <http://localhost:8001/docs>
- API health: <http://localhost:8000/health>
- AI health: <http://localhost:8001/health>

Follow logs:

```bash
docker compose logs -f game api ai db
```

Stop without deleting progress:

```bash
docker compose down
```

Delete containers and **all local PostgreSQL data**:

```bash
docker compose down -v
```

The `-v` command permanently removes local users, sessions, rewards, and
analytics.

## Playing the game

The browser automatically creates anonymous guest credentials. There is no
visible login or sign-up screen yet. Clearing site storage creates a new guest
identity and disconnects the browser from its previous progress.

### Roleplay controls

| Control | Action |
|---|---|
| Click the floor | Walk to a location |
| `E` near an NPC or supported object | Interact |
| Text field + `Enter` | Submit dialogue or an object name |
| Microphone button | Start or stop recording |
| `L` | Move from the bakery to the library |
| `B` | Move from the library to the bakery |
| `P` | Open or close the Praglish Journal |
| `M` | Return to the main menu |
| `Esc` | Close the active panel |

Allow microphone access in the browser. It works on `localhost`; remote
access normally requires HTTPS.

### Dub the Scene controls

Choose a scene and character. Use replay to hear the reference, the microphone
button to record, and continue after scoring. The book icon opens the dubbing
journal. The final screen can replay the complete scene or restart the exercise.

## Configuration reference

### AI provider variables

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | empty | Enables Gemini. Gemini wins if both provider keys are set. |
| `GEMINI_TTS_API_KEY` | empty | Optional separate Gemini key used only for TTS. |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini NPC and extraction model. |
| `GEMINI_EVALUATOR_MODEL` | `GEMINI_MODEL` | Optional evaluator model override. |
| `CORRECTION_MODEL` | `gemini-3.5-flash-lite` | Gemini correction model. |
| `STT_MODEL` | `gemini-3.5-transcribe` | Gemini speech-to-text model. |
| `TTS_MODEL` | `gemini-3.1-flash-tts-preview` | Gemini text-to-speech model. |
| `GROQ_API_KEY` | empty | Enables Groq when the Gemini key is empty. |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq NPC and extraction model. |
| `GROQ_EVALUATOR_MODEL` | `llama-3.1-8b-instant` | Groq evaluator model. |
| `GROQ_CORRECTION_MODEL` | `llama-3.1-8b-instant` | Groq correction model. |
| `GROQ_STT_MODEL` | `whisper-large-v3-turbo` | Groq speech-to-text model. |
| `GROQ_TTS_MODEL` | `canopylabs/orpheus-v1-english` | Groq text-to-speech model. |

Provider switching is configuration-based, not automatic per-request failover.

### Application variables

| Variable | Default | Purpose |
|---|---|---|
| `USE_MOCK_AI` | `false` in Compose | Uses fixed roleplay replies; it does not mock real speech. |
| `LANGUAGE_ACCEPTANCE_THRESHOLD` | `50` | Minimum contextual plausibility score from 0 to 100. |
| `STT_MAX_AUDIO_BYTES` | `10485760` | Maximum AI-service recording size; the API also enforces 10 MiB. |
| `CORS_ORIGINS` | local game URLs | Comma-separated browser origins allowed to call the API. |
| `DATABASE_URL` | local PostgreSQL fallback | SQLAlchemy connection string. Compose supplies the container URL. |
| `AI_SERVICE_URL` | `http://ai:8001` | AI service address used by the API. |
| `PORT` | `8000` | API container port; hosting platforms may supply it dynamically. |
| `AI_EVALUATION_TIMEOUT_SECONDS` | `120` | Evaluation and NPC request timeout. |
| `AI_EXTRACTION_TIMEOUT_SECONDS` | `120` | Background extraction timeout. |
| `AI_SPEECH_TIMEOUT_SECONDS` | `45` | STT and TTS timeout. |

Do not commit `.env`. Never expose provider keys in frontend code.

## Progress and data

PostgreSQL stores guest profiles, XP, coins, sessions, accepted dialogue,
vocabulary progress, activity events, and learning analytics. The Praglish
Journal reports:

- Profile level, XP, and coins
- Correct and incorrect turn totals
- Seven-day activity and practice by location
- Grammar-topic mastery
- Vocabulary use by CEFR level
- Vocabulary error types, including collocation and lexical choice
- Idioms used correctly or needing practice

Roleplay context resets for a new play session, while account-level progress
remains persistent. Dubbing completion stays in browser `localStorage`.

The current authentication is a prototype guest mechanism, not a production
account system.

## Architecture

```text
praglish/
├── game/                 Phaser, TypeScript, Vite, UI, scenes, and assets
├── api/                  FastAPI gameplay API, persistence, and analytics
│   ├── game_data/        Scenario and vocabulary definitions
│   ├── routes/           Public API routes
│   └── tests/            Unit and integration tests
├── ai/                   Evaluation, coaching, NPC, extraction, STT, and TTS
│   ├── modules/          Gemini/Groq implementations
│   ├── prompts/          Language pipeline prompts
│   └── tests/            AI-service tests
├── shared/               Contracts shared by the API and AI services
├── docker-compose.yml    Local development stack
└── .env.example          Configuration template
```

| Service | Technology | Port | Responsibility |
|---|---|---:|---|
| `game` | Phaser, TypeScript, Vite | 5173 | Game client |
| `api` | FastAPI, SQLAlchemy | 8000 | Sessions, rewards, vocabulary, analytics, speech proxy |
| `ai` | FastAPI, Gemini/Groq | 8001 | Evaluation, coaching, NPCs, extraction, STT, TTS |
| `db` | PostgreSQL 16 | 5432 | Persistent data |

## Frontend-only development

Node.js 24 is recommended:

```bash
cd game
npm ci
npm run dev:mock-api
```

Keep that terminal open and start the game in another:

```bash
cd game
npm run dev
```

The mock API listens on port 8000. Its STT result is fixed and its TTS output is
silent, so this validates UI wiring rather than real language or audio quality.

Useful commands:

```bash
npm test
npm run typecheck
npm run build
```

## Tests

With the Docker stack running:

```bash
docker compose exec api python -m unittest discover -s tests
docker compose exec ai python -m unittest discover -s tests
docker compose exec game npm test
```

Run the full integration smoke test after all services are healthy:

```bash
python api/tests/test_integration_smoke.py
```

Without host Python:

```bash
docker compose exec api sh -c "SMOKE_AI_URL=http://ai:8001 SMOKE_GAME_URL=http://game:5173 python tests/test_integration_smoke.py"
```

The smoke test checks service health, starts a session, plays consecutive turns,
verifies conversation continuity, and confirms dashboard activity.

## API overview

| Endpoint | Purpose |
|---|---|
| `POST /api/session/start` | Create/authenticate a guest and start a scenario |
| `POST /api/session/{session_id}/turn` | Evaluate a response and advance the scenario |
| `GET /api/user/{user_id}` | Read XP and coins |
| `GET /api/leaderboard/` | Read the top ten users by XP |
| `POST /api/vocabulary/submit` | Validate and reward a word or synonym |
| `GET /api/vocabulary/progress/{user_id}/{location}` | Read room vocabulary progress |
| `POST /api/speech/stt` | Transcribe a recording verbatim |
| `POST /api/speech/tts` | Synthesize a reply as WAV |
| `POST /api/analytics/dashboard` | Read profile and language analytics |
| `GET /api/dub/scripts` | List scenes by difficulty |
| `POST /api/dub/scripts/{script_id}/lines/{line_id}/score` | Score a recording word by word |

## Deployment notes

- Build API and AI services from their own Dockerfiles with the repository root
  as the Docker build context.
- Set `DATABASE_URL` to the hosted PostgreSQL internal connection URL.
- Set `AI_SERVICE_URL` to the deployed AI service URL.
- Set at least one provider key on the AI service.
- Set `CORS_ORIGINS` to the deployed game origin.
- The API reads the platform-provided `PORT` and falls back to 8000 locally.
- Use HTTPS for deployed microphone access.
- The API creates missing tables at startup, but `create_all()` does not
  migrate existing columns. Use Alembic before storing production data.

## Troubleshooting

### The backend is unavailable

```bash
docker compose ps
docker compose logs -f api db
```

Check <http://localhost:8000/health>. A browser CORS message can hide a real API
or database error, so inspect API logs before changing CORS.

### The local database schema is outdated

```bash
docker compose down -v
docker compose up --build -d
```

This deletes all local data. Migrate a production database instead.

### The AI service reports `unconfigured`

Set `GEMINI_API_KEY` or `GROQ_API_KEY`, then run:

```bash
docker compose up --build -d ai
```

### The microphone does not work

Allow browser microphone permission, use `localhost` or HTTPS, and confirm that
the AI service has a valid provider key. Mock roleplay does not replace STT/TTS.

### The deployed API listens on the wrong port

Do not hard-code the hosting port. The API image uses `${PORT:-8000}`, so it
reads the platform's `PORT` and uses 8000 only as a local fallback.

## Current limitations

- Cafe, hospital, and school are not playable yet.
- Speech is push-to-talk; streaming and interruption are not supported.
- Provider selection occurs at startup with no automatic request-level failover.
- Mock mode does not provide meaningful speech or dubbing evaluation.
- Guest authentication is suitable for a prototype, not production.
- Production schema changes require a complete Alembic migration workflow.

Praglish does not replace learning. It creates the missing space between
knowing English and actually using it.
