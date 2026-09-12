
"""Single-player Listen and Repeat endpoints for Dub the Scene.

Scripts are stateless definitions served to the client. A player chooses one
character, listens to each line, records a repetition, and receives a word-level
score. Original audio and muted video are used only for verified public-domain
sources; otherwise lines are synthesized through TTS. Media timestamps share the
same timeline and are played by the client without server-side transcoding.

The included clips come from the public-domain films Charade (1963), Superman:
The Underground World (1943), Night of the Living Dead (1968), and Gulliver's
Travels (1939). Their titles and characters may still be protected as trademarks;
Praglish presents them only as educational dubbing exercises and does not imply
official affiliation.
"""

import difflib
import logging

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from services.ai_client import transcribe_audio

router = APIRouter()
logger = logging.getLogger(__name__)


MAX_RECORDING_BYTES = 10 * 1024 * 1024


# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------


class ScriptLine(BaseModel):
    id: int
    speaker: str
    text: str





    # Gemini prebuilt voice used when the parent script has no original audio.
    voice: str = "Kore"
    # Bounds within the script's shared audio and video timeline.




    start_seconds: float | None = None
    end_seconds: float | None = None


class DubScript(BaseModel):
    id: str
    title: str
    characters: list[str]
    lines: list[ScriptLine]







    # Game-origin paths for optional source audio and synchronized muted video.
    audio_url: str | None = None






    video_url: str | None = None



    # Computed automatically when the module loads.
    difficulty_score: int = 0
    level: int = 0


SCRIPTS: dict[str, DubScript] = {























    "charade-44": DubScript(
        id="charade-44",
        title="Charade (1963)",
        characters=["Reggie", "Bartholomew"],
        audio_url="/assets/dub/charade-44.m4a",
        video_url="/assets/dub/charade-44.mp4",
        lines=[
            ScriptLine(
                id=1,
                speaker="Bartholomew",
                text="Well, you followed?",
                start_seconds=5.1,
                end_seconds=6.5,
            ),
            ScriptLine(
                id=2,
                speaker="Reggie",




                text="Yes, by Dyle, but I lost him.",
                start_seconds=7.2,
                end_seconds=9.0,
            ),
            ScriptLine(
                id=3,



                speaker="Reggie",
                text="I'm beginning to think women make the best spies.",
                start_seconds=9.5,
                end_seconds=11.4,
            ),
            ScriptLine(
                id=4,



                speaker="Bartholomew",
                text="Agents.",
                start_seconds=11.8,
                end_seconds=13.0,
            ),
            ScriptLine(
                id=5,
                speaker="Reggie",
                text="He has a gun, Mr. Bartholomew.",
                start_seconds=13.2,
                end_seconds=14.7,
            ),
            ScriptLine(id=6, speaker="Bartholomew", text="No.", start_seconds=16.0, end_seconds=16.3),
            ScriptLine(
                id=7,
                speaker="Reggie",




                text="But I saw it.",
                start_seconds=16.6,
                end_seconds=17.7,
            ),
            ScriptLine(
                id=8,
                speaker="Bartholomew",
                text="No, that's not Carson Dyle.",
                start_seconds=17.9,
                end_seconds=19.8,
            ),
            ScriptLine(id=9, speaker="Reggie", text="Carson?", start_seconds=20.5, end_seconds=20.9),
            ScriptLine(
                id=10,
                speaker="Bartholomew",
                text="There's only one Dyle connected with this affair, Mrs. Lampert, that's Carson Dyle.",
                start_seconds=21.8,
                end_seconds=25.2,
            ),
            ScriptLine(
                id=11,
                speaker="Reggie",
                text="You mean you've known about him all along?",
                start_seconds=25.9,
                end_seconds=27.5,
            ),
            ScriptLine(
                id=12,
                speaker="Bartholomew",
                text="It's enough to make you a vegetarian, isn't it?",
                start_seconds=29.1,
                end_seconds=31.9,
            ),
            ScriptLine(
                id=13,
                speaker="Reggie",
                text="It's just lucky that I'm not hanging next to one of those things right now.",
                start_seconds=33.2,
                end_seconds=36.3,
            ),
            ScriptLine(
                id=14,
                speaker="Reggie",
                text="Why didn't you tell me you knew about Dyle?",
                start_seconds=36.8,
                end_seconds=40.6,
            ),
            ScriptLine(
                id=15,
                speaker="Bartholomew",
                text="I didn't see any point. Dyle's dead.",
                start_seconds=41.0,
                end_seconds=42.8,
            ),
            ScriptLine(
                id=16,
                speaker="Reggie",
                text="Mr. Bartholomew, what is all this about?",
                start_seconds=44.7,
                end_seconds=None,
            ),
        ],
    ),
























    "superman-caverns": DubScript(
        id="superman-caverns",
        title="Superman (1943)",


        characters=["Henderson", "Clark Kent", "Lois Lane", "Mr. White"],
        audio_url="/assets/dub/superman-caverns.m4a",
        video_url="/assets/dub/superman-caverns.mp4",
        lines=[
            ScriptLine(
                id=1,
                speaker="Henderson",
                text="And while on a hunting trip, my father discovered what are now known as the Henderson Caverns.",
                start_seconds=0.2,
                end_seconds=5.7,
            ),
            ScriptLine(
                id=2,
                speaker="Henderson",
                text="More than 40 years ago, he mysteriously disappeared while exploring them further.",
                start_seconds=6.6,
                end_seconds=10.9,
            ),
            ScriptLine(
                id=3,
                speaker="Henderson",
                text=(
                    "Recently I found these maps and charts he left, suggesting there are still "
                    "greater wonders and mysteries lay beyond in this vast underground world."
                ),
                start_seconds=12.1,
                end_seconds=20.3,
            ),
            ScriptLine(
                id=4,
                speaker="Henderson",
                text=(
                    "Now if your paper will help finance the expedition, I will take Miss Lane "
                    "and Mr. Kent with me and guarantee the Daily Planet exclusive rights to the story."
                ),
                start_seconds=21.2,
                end_seconds=30.0,
            ),
            ScriptLine(
                id=5,
                speaker="Clark Kent",
                text="Sounds like a great story, Chief.",
                start_seconds=30.9,
                end_seconds=32.2,
            ),
            ScriptLine(
                id=6,
                speaker="Lois Lane",
                text="I'd love to go.",
                start_seconds=32.6,
                end_seconds=33.7,
            ),
            ScriptLine(
                id=7,
                speaker="Mr. White",
                text="Well, let me see...",
                start_seconds=34.6,
                end_seconds=36.3,
            ),
            ScriptLine(
                id=8,
                speaker="Mr. White",
                text="All right, it's a deal.",
                start_seconds=37.4,
                end_seconds=38.4,
            ),
            ScriptLine(
                id=9,
                speaker="Henderson",
                text="Thanks, Mr. White. We can leave immediately.",
                start_seconds=39.0,
                end_seconds=None,
            ),
        ],
    ),

























    "notld-cemetery": DubScript(
        id="notld-cemetery",
        title="Night of the Living Dead (1968)",
        characters=["Barbra", "Johnny"],
        audio_url="/assets/dub/notld-cemetery.m4a",
        video_url="/assets/dub/notld-cemetery.mp4",
        lines=[
            ScriptLine(
                id=1,
                speaker="Barbra",
                text="They ought to make the day the time changes the first day of summer.",
                start_seconds=2.0,
                end_seconds=5.8,
            ),
            ScriptLine(
                id=2,
                speaker="Johnny",
                text="What?",
                start_seconds=5.8,
                end_seconds=6.9,
            ),
            ScriptLine(
                id=3,
                speaker="Barbra",
                text="Well, it's eight o'clock and it's still light.",
                start_seconds=6.9,
                end_seconds=9.3,
            ),
            ScriptLine(
                id=4,
                speaker="Johnny",
                text=(
                    "A lot of good the extra daylight does us. Now we've still got a "
                    "three-hour drive back. We're not going to be home until after midnight."
                ),
                start_seconds=9.3,
                end_seconds=15.9,
            ),
            ScriptLine(
                id=5,
                speaker="Barbra",
                text="Well, if it really bugged you, Johnny, you wouldn't do it.",
                start_seconds=15.9,
                end_seconds=18.7,
            ),
            ScriptLine(
                id=6,
                speaker="Johnny",
                text=(
                    "You think I wanna blow Sunday on a scene like this? You know, I figure "
                    "we're either gonna have to move Mother out here or move the grave into Pittsburgh."
                ),
                start_seconds=18.7,
                end_seconds=26.3,
            ),
            ScriptLine(
                id=7,
                speaker="Barbra",
                text="She can't make a trip like this.",
                start_seconds=26.3,
                end_seconds=28.2,
            ),
            ScriptLine(
                id=8,
                speaker="Johnny",
                text="Oh, I know that she can't.",
                start_seconds=28.2,
                end_seconds=29.9,
            ),
            ScriptLine(
                id=9,
                speaker="Johnny",
                text="Is there any of that candy left?",
                start_seconds=29.9,
                end_seconds=32.6,
            ),
            ScriptLine(
                id=10,


                speaker="Barbra",
                text="No.",
                start_seconds=32.6,
                end_seconds=33.1,
            ),
            ScriptLine(
                id=11,


                speaker="Johnny",
                text='Look at this thing. "We still remember." I don\'t. You know, I don\'t even remember what the man looks like.',
                start_seconds=33.1,
                end_seconds=40.0,
            ),
            ScriptLine(
                id=12,
                speaker="Barbra",
                text="Johnny, it takes you five minutes.",
                start_seconds=40.0,
                end_seconds=41.6,
            ),
            ScriptLine(
                id=13,
                speaker="Johnny",
                text=(
                    "Yeah, five minutes to put the wreath on the grave and six hours to drive "
                    "back and forth. Mother wants to remember, so we trot 200 miles into the "
                    "country and she stays at home."
                ),
                start_seconds=41.6,
                end_seconds=50.8,
            ),
            ScriptLine(
                id=14,
                speaker="Barbra",
                text="Well, we're here, John, all right?",
                start_seconds=50.8,
                end_seconds=None,
            ),
        ],
    ),

























    "gulliver-wedding": DubScript(
        id="gulliver-wedding",
        title="Gulliver's Travels (1939)",
        characters=["King Little", "King Bombo"],
        audio_url="/assets/dub/gulliver-wedding.m4a",
        video_url="/assets/dub/gulliver-wedding.mp4",
        lines=[
            ScriptLine(
                id=1,
                speaker="King Little",
                text="Your Majesty.",
                start_seconds=2.9,
                end_seconds=6.2,
            ),
            ScriptLine(
                id=2,
                speaker="King Bombo",
                text="Thank you, Your Majesty.",
                start_seconds=6.2,
                end_seconds=9.7,
            ),
            ScriptLine(
                id=3,
                speaker="King Bombo",
                text="Marriage Contract.",
                start_seconds=9.7,
                end_seconds=12.8,
            ),
            ScriptLine(
                id=4,


                speaker="King Bombo",
                text="King Little...",
                start_seconds=12.8,
                end_seconds=13.9,
            ),
            ScriptLine(
                id=5,
                speaker="King Bombo",
                text=(
                    "...of Lilliput does this 5th day of November 1699 give the hand "
                    "of his daughter, Princess Glory..."
                ),
                start_seconds=13.9,
                end_seconds=20.0,
            ),
            ScriptLine(
                id=6,
                speaker="King Bombo",
                text="...to Prince David, son of Bombo, King of Blefuscu.",
                start_seconds=20.0,
                end_seconds=30.0,
            ),
            ScriptLine(
                id=7,
                speaker="King Bombo",
                text="Quite in order, right.",
                start_seconds=30.0,
                end_seconds=31.0,
            ),
            ScriptLine(
                id=8,
                speaker="King Bombo",
                text="King... Bom... bo!",
                start_seconds=31.0,
                end_seconds=34.3,
            ),
            ScriptLine(
                id=9,
                speaker="King Bombo",
                text="Well, we did it, you little rascal, you. We did it!",
                start_seconds=49.0,
                end_seconds=51.7,
            ),
            ScriptLine(
                id=10,
                speaker="King Little",
                text="Yes, we certainly did, didn't we?",
                start_seconds=51.7,
                end_seconds=52.9,
            ),
            ScriptLine(
                id=11,
                speaker="King Bombo",
                text="Just a couple of old dad cupids, I think.",
                start_seconds=52.9,
                end_seconds=55.2,
            ),
            ScriptLine(
                id=12,
                speaker="King Little",
                text="A couple of old dad cupids!",
                start_seconds=55.2,
                end_seconds=None,
            ),
        ],
    ),
}


# ---------------------------------------------------------------------------
# Difficulty scoring and level assignment
#
# The score combines unique-word rarity (55%), average word length (25%), and
# average line length (20%). It is a relative ordering heuristic rather than a
# formal measure of linguistic difficulty.
# ---------------------------------------------------------------------------

COMMON_WORDS: frozenset[str] = frozenset(
    """
    the be to of and a in that have i it for not on with he as you do at
    this but his by from they we say her she or an will my one all would
    there their what so up out if about who get which go me when make can
    like time no just him know take people into year your good some could
    them see other than then now look only come its over think also back
    after use two how our work first well way even new want because any
    these give day most us is was are been has had were said did going
    got very much many more before still should never being does doing
    having might must shall need used always sometimes often once again
    here where why whose whom each few most own same both either neither
    thing things man woman child life world hand part place case week
    month night point water room area money story fact group country
    problem question house right left big small long short high low old
    young great little another sure true real best better worse worst
    yes no thank please sorry hello goodbye morning afternoon evening
    friend love happy sad angry tired hungry thirsty hot cold fast slow
    easy hard open close start stop begin end follow lost found lose win
    play game work school home car house food drink eat sleep walk run
    talk speak listen hear watch see look feel touch smell taste
    """.split()
)


def _compute_difficulty_score(lines: list[ScriptLine]) -> int:
    words = [w for line in lines for w in line.text.split()]
    if not words:
        return 1

    normalized = ["".join(ch for ch in w.lower() if ch.isalpha()) for w in words]
    normalized = [w for w in normalized if w]
    unique_words = set(normalized) or {""}
    rare_ratio = sum(1 for w in unique_words if w not in COMMON_WORDS) / len(unique_words)

    avg_word_len = sum(len(w) for w in normalized) / len(normalized) if normalized else 0

    # Normalize from roughly three-letter words to eight-letter words.
    word_len_score = max(0.0, min(1.0, (avg_word_len - 3) / 5))

    avg_line_len = sum(len(line.text.split()) for line in lines) / len(lines)

    # Normalize from roughly three-word lines to fifteen-word lines.
    line_len_score = max(0.0, min(1.0, (avg_line_len - 3) / 12))

    raw_score = 55 * rare_ratio + 25 * word_len_score + 20 * line_len_score
    return max(1, min(100, round(raw_score)))


def _assign_difficulty_and_levels(scripts: dict[str, DubScript]) -> None:
    for script in scripts.values():
        script.difficulty_score = _compute_difficulty_score(script.lines)

    ordered_ids = sorted(scripts, key=lambda script_id: scripts[script_id].difficulty_score)
    for level, script_id in enumerate(ordered_ids, start=1):
        scripts[script_id].level = level


_assign_difficulty_and_levels(SCRIPTS)


@router.get("/scripts", response_model=list[DubScript])
def list_scripts() -> list[DubScript]:
    return sorted(SCRIPTS.values(), key=lambda script: script.level)


# ---------------------------------------------------------------------------
# Recording evaluation (speech-to-text plus word alignment)
# ---------------------------------------------------------------------------


class WordVerdict(BaseModel):
    word: str
    correct: bool


class ScoreLineResponse(BaseModel):
    transcript: str
    expected: str
    words: list[WordVerdict]
    accuracy_percent: float


def _normalize_word(word: str) -> str:
    return "".join(ch for ch in word.lower() if ch.isalnum())


def _score_transcript(*, expected: str, actual: str) -> tuple[list[WordVerdict], float]:
    """Align expected and transcribed words without penalizing index shifts."""
    expected_words = expected.split()
    actual_norm = [_normalize_word(w) for w in actual.split()]
    expected_norm = [_normalize_word(w) for w in expected_words]

    matcher = difflib.SequenceMatcher(None, expected_norm, actual_norm, autojunk=False)
    verdicts = [WordVerdict(word=w, correct=False) for w in expected_words]
    for tag, i1, i2, _j1, _j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                verdicts[i1 + offset] = WordVerdict(word=expected_words[i1 + offset], correct=True)

    correct_count = sum(1 for v in verdicts if v.correct)
    accuracy = round(100 * correct_count / len(verdicts), 1) if verdicts else 0.0
    return verdicts, accuracy


@router.post("/scripts/{script_id}/lines/{line_id}/score", response_model=ScoreLineResponse)
async def score_line(
    script_id: str,
    line_id: int,
    audio: UploadFile = File(...),
) -> ScoreLineResponse:
    script = SCRIPTS.get(script_id)
    if script is None:
        raise HTTPException(status_code=404, detail=f"Unknown script_id: {script_id}")
    line = next((l for l in script.lines if l.id == line_id), None)
    if line is None:
        raise HTTPException(status_code=404, detail="Line not found")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio recording is empty.")
    if len(audio_bytes) > MAX_RECORDING_BYTES:
        raise HTTPException(status_code=413, detail="Audio recording is too long.")




    try:
        stt_result = await transcribe_audio(
            audio_bytes,
            content_type=audio.content_type or "audio/webm",
            language_code="en-US",
        )
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=502, detail=f"Speech-to-text service error: {error}"
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503, detail="Speech-to-text service is unavailable."
        ) from error

    words, accuracy = _score_transcript(expected=line.text, actual=stt_result.text)

    return ScoreLineResponse(
        transcript=stt_result.text,
        expected=line.text,
        words=words,
        accuracy_percent=accuracy,
    )
