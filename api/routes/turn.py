import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from models.models import Dialogue, GameSession, User
from services.ai_client import evaluate_and_respond, extract_utterance
from services.learning_analytics import LearningAnalyticsService
from services.reward_engine import RewardEngine
from services.scenario_engine import ScenarioEngine
from shared.schemas import (
    DialogueTurn,
    EvaluateRequest,
    EvaluateResponse,
    ExtractionRequest,
    RewardInfo,
)

router = APIRouter()
logger = logging.getLogger(__name__)


class TurnRequest(BaseModel):
    user_text: str


@router.post("/{session_id}/turn", response_model=EvaluateResponse)
async def process_turn(session_id: int, request: TurnRequest, db: Session = Depends(get_db)):
    session = db.query(GameSession).filter(GameSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.is_active:
        raise HTTPException(status_code=400, detail="Session is closed")

    # Kullanicinin cumlesini once kaydet (henuz degerlendirme sonucu yok)
    user_dialogue = Dialogue(session_id=session.id, speaker="user", text=request.user_text)
    db.add(user_dialogue)
    db.commit()
    db.refresh(user_dialogue)

    # Gecmisi DB'den derle - client'in gondermesine gerek yok, guvenilir kaynak burasi
    dialogues = (
        db.query(Dialogue)
        .filter(Dialogue.session_id == session.id)
        .order_by(Dialogue.created_at.asc())
        .all()
    )
    dialogue_history = [DialogueTurn(speaker=d.speaker, text=d.text) for d in dialogues]

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

    user_dialogue.is_natural = result.accepted
    user_dialogue.correction = result.correction

    # CorrectExtractor yalnizca kabul edilen kullanimlari, IncorrectExtractor
    # yalnizca reddedilen cumledeki somut hatalari sayar. Extractor analytics
    # oldugu icin gecici bir AI/DB hatasi oyun turunu bloke etmez.
    accepted_history = [
        DialogueTurn(speaker=d.speaker, text=d.text)
        for d in dialogues
        if d.id != user_dialogue.id and (d.speaker == "npc" or d.is_natural is True)
    ]
    scenario_data = ScenarioEngine.load_scenario(session.location)
    extraction_payload = ExtractionRequest(
        utterance=request.user_text,
        outcome="correct" if result.accepted else "incorrect",
        context=f"{session.location} role-play",
        speaker="player",
        listener=session.npc_role,
        communicative_goals=[
            f"Complete scenario field: {field}"
            for field in scenario_data.get("required_fields", [])
        ],
        dialogue_history=accepted_history,
        evaluation_reason=result.evaluation_reason or result.correction,
    )
    try:
        extraction_result = await extract_utterance(extraction_payload)
        if extraction_result is not None:
            with db.begin_nested():
                LearningAnalyticsService.record_extraction(
                    db,
                    user_id=session.user_id,
                    session_id=session.id,
                    dialogue_id=user_dialogue.id,
                    utterance=request.user_text,
                    result=extraction_result,
                )
    except Exception:  # analytics must fail open during gameplay
        logger.exception("Language extraction failed for dialogue %s", user_dialogue.id)

    # Odul motoru - result Pydantic nesnesi, .get() degil dogrudan attribute erisimi
    reward_info = RewardEngine.process_turn_reward(
        db=db, user_id=session.user_id, is_accepted=result.accepted
    )
    if reward_info:
        result.rewards = RewardInfo(**reward_info)

    db.add(Dialogue(session_id=session.id, speaker="npc", text=result.npc_response))

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

    return result
