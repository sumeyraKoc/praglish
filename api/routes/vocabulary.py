from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from models.models import User, VocabularyProgress
from services.vocabulary_engine import VocabularyEngine

router = APIRouter()


class VocabularySubmitRequest(BaseModel):
    user_id: int
    location: str
    concept: str
    word: str


def _count_earned(db: Session, user_id: int, location: str, concept: str) -> int:
    return (
        db.query(VocabularyProgress)
        .filter(
            VocabularyProgress.user_id == user_id,
            VocabularyProgress.location == location,
            VocabularyProgress.concept == concept,
        )
        .count()
    )


@router.post("/submit")
def submit_word(request: VocabularySubmitRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == request.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    concept_data = VocabularyEngine.find_concept(request.location, request.concept)
    if not concept_data:
        raise HTTPException(status_code=404, detail="Concept not found for this location")

    matched_entry = VocabularyEngine.match_word(concept_data, request.word)
    if not matched_entry:
        # Kelime bu konseptin kabul edilen listesinde yok - odul yok
        return {
            "matched": False,
            "already_earned": False,
            "reward_coins": 0,
            "concept_completed": False,
        }

    matched_word = matched_entry["word"]

    already = (
        db.query(VocabularyProgress)
        .filter(
            VocabularyProgress.user_id == request.user_id,
            VocabularyProgress.location == request.location,
            VocabularyProgress.concept == request.concept,
            VocabularyProgress.word == matched_word,
        )
        .first()
    )

    words_total = len(concept_data["words"])

    if already:
        # Bu kelime icin daha once zaten odul verilmis - tekrar verme
        earned_count = _count_earned(db, request.user_id, request.location, request.concept)
        return {
            "matched": True,
            "already_earned": True,
            "reward_coins": 0,
            "words_earned": earned_count,
            "words_total": words_total,
            "concept_completed": earned_count >= words_total,
        }

    reward_coins = matched_entry.get("reward_coins", 0)
    db.add(
        VocabularyProgress(
            user_id=request.user_id,
            location=request.location,
            concept=request.concept,
            word=matched_word,
        )
    )
    user.coins += reward_coins
    db.commit()

    earned_count = _count_earned(db, request.user_id, request.location, request.concept)
    return {
        "matched": True,
        "already_earned": False,
        "reward_coins": reward_coins,
        "words_earned": earned_count,
        "words_total": words_total,
        "concept_completed": earned_count >= words_total,
        "total_coins": user.coins,
    }


@router.get("/progress/{user_id}/{location}")
def get_progress(user_id: int, location: str, db: Session = Depends(get_db)):
    vocab = VocabularyEngine.load_vocabulary(location)

    progress_rows = (
        db.query(VocabularyProgress)
        .filter(VocabularyProgress.user_id == user_id, VocabularyProgress.location == location)
        .all()
    )
    earned_set = {(r.concept, r.word) for r in progress_rows}

    result = []
    for c in vocab.get("concepts", []):
        words_status = [
            {"word": w["word"], "earned": (c["concept"], w["word"]) in earned_set}
            for w in c["words"]
        ]
        result.append(
            {
                "concept": c["concept"],
                "words": words_status,
                "completed": all(w["earned"] for w in words_status),
            }
        )
    return result
