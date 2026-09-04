import logging
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import SessionLocal, get_db
from models.models import Dialogue, GameSession, User
from services.ai_client import evaluate_and_respond, extract_utterance
from services.dialogue_history import build_evaluator_history
from services.learning_analytics import LearningAnalyticsService
from services.reward_engine import RewardEngine
from services.scenario_engine import ScenarioEngine
from shared.schemas import (
    EvaluateRequest,
    EvaluateResponse,
    ExtractionRequest,
    RewardInfo,
)

router = APIRouter()
logger = logging.getLogger(__name__)


async def _record_extraction_background(
    payload: ExtractionRequest,
    *,
    outcome: Literal["correct", "incorrect"],
    user_id: int,
    session_id: int,
    dialogue_id: int | None,
    utterance: str,
) -> None:
    """Run optional learning analytics without delaying the gameplay response."""

    db = SessionLocal()
    try:
        extraction_result = await extract_utterance(payload, outcome)
        if extraction_result is None:
            return
        LearningAnalyticsService.record_extraction(
            db,
            user_id=user_id,
            session_id=session_id,
            dialogue_id=dialogue_id,
            utterance=utterance,
            result=extraction_result,
        )
        db.commit()
    except Exception:  # analytics must fail open during gameplay
        db.rollback()
        logger.exception("Language extraction failed for session %s", session_id)
    finally:
        db.close()


class TurnRequest(BaseModel):
    user_text: str


@router.post("/{session_id}/turn", response_model=EvaluateResponse)
async def process_turn(
    session_id: int,
    request: TurnRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    session = db.query(GameSession).filter(GameSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.is_active:
        raise HTTPException(status_code=400, detail="Session is closed")

    # Tum gercek NPC mesajlarini ve yalnizca kabul edilmis kullanici mesajlarini al.
    dialogues = (
        db.query(Dialogue)
        .filter(Dialogue.session_id == session.id)
        .order_by(Dialogue.created_at.asc(), Dialogue.id.asc())
        .all()
    )
    dialogue_history = build_evaluator_history(dialogues)

    payload = EvaluateRequest(
        location=session.location,
        npc_role=session.npc_role,
        scenario_state=session.scenario_state or {},
        dialogue_history=dialogue_history,
        user_text=request.user_text,
    )

    # ai_client.py uzerinden gidiyoruz ki USE_MOCK_AI korumasi calismaya devam etsin
    # (ai container ayakta olmasa bile bu route test edilebilsin)
    result = await evaluate_and_respond(payload)

    # CorrectExtractor yalnizca kabul edilen kullanimlari, IncorrectExtractor
    # yalnizca reddedilen cumledeki somut hatalari sayar. Extractor analytics
    # oldugu icin gecici bir AI/DB hatasi oyun turunu bloke etmez.
    extraction_payload = ExtractionRequest(utterance=request.user_text)
    # Odul motoru - result Pydantic nesnesi, .get() degil dogrudan attribute erisimi
    reward_info = RewardEngine.process_turn_reward(
        db=db, user_id=session.user_id, is_accepted=result.accepted
    )
    if reward_info:
        result.rewards = RewardInfo(**reward_info)

    dialogue_id: int | None = None
    if result.accepted:
        user_dialogue = Dialogue(
            session_id=session.id,
            speaker="user",
            text=request.user_text,
            is_natural=True,
        )
        db.add(user_dialogue)
        db.flush()
        dialogue_id = user_dialogue.id

    if result.response_speaker == "npc":
        db.add(
            Dialogue(
                session_id=session.id,
                speaker="npc",
                text=result.npc_response,
            )
        )

    session.scenario_state = result.updated_scenario_state

    # Senaryo tamamlandi mi kontrol et (result bir Pydantic nesnesi, .get() degil
    # dogrudan attribute erisimi kullaniyoruz)
    is_completed, completion_rewards = ScenarioEngine.is_scenario_completed(
        session.location, session.scenario_state
    )

    if is_completed:
        session.is_active = False

        bonus_xp = completion_rewards.get("completion_xp_bonus", 0)
        bonus_coin = completion_rewards.get("completion_coin_bonus", 0)

        bonus_user = db.query(User).filter(User.id == session.user_id).first()
        bonus_user.xp += bonus_xp
        bonus_user.coins += bonus_coin

        if result.rewards:
            result.rewards.gained_xp += bonus_xp
            result.rewards.gained_coins += bonus_coin
            result.rewards.total_xp = bonus_user.xp
            result.rewards.total_coins = bonus_user.coins
        else:
            result.rewards = RewardInfo(
                gained_xp=bonus_xp,
                gained_coins=bonus_coin,
                total_xp=bonus_user.xp,
                total_coins=bonus_user.coins,
            )

    db.commit()

    background_tasks.add_task(
        _record_extraction_background,
        extraction_payload,
        outcome="correct" if result.accepted else "incorrect",
        user_id=session.user_id,
        session_id=session.id,
        dialogue_id=dialogue_id,
        utterance=request.user_text,
    )

    return result
