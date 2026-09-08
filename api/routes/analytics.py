from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import hash_password, verify_password
from models.models import User
from services.dashboard_analytics import build_dashboard


router = APIRouter()


class DashboardRequest(BaseModel):
    username: str
    password: str


class ProfileSummary(BaseModel):
    user_id: int
    username: str
    xp: int
    coins: int
    level: int


class LearningSummary(BaseModel):
    total_turns: int
    correct_turns: int
    incorrect_turns: int
    success_percent: float
    words_learned: int
    idioms_discovered: int


class DailyActivity(BaseModel):
    date: str
    correct: int
    incorrect: int


class LocationActivity(BaseModel):
    name: str
    turn_count: int


class GrammarTopicSummary(BaseModel):
    topic_id: int
    topic_name: str
    correct_count: int
    incorrect_count: int
    mastery_percent: float


class NamedCount(BaseModel):
    name: str
    count: int


class IdiomSummary(BaseModel):
    normalized_idiom: str
    display_idiom: str
    correct_count: int
    incorrect_count: int
    last_used_at: datetime | None


class DashboardResponse(BaseModel):
    profile: ProfileSummary
    summary: LearningSummary
    weekly_activity: list[DailyActivity]
    locations: list[LocationActivity]
    grammar_topics: list[GrammarTopicSummary]
    vocabulary_levels: list[NamedCount]
    vocabulary_errors: list[NamedCount]
    idioms: list[IdiomSummary]


@router.post("/dashboard", response_model=DashboardResponse)
def get_dashboard(payload: DashboardRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if user is None:
        user = User(username=payload.username, password_hash=hash_password(payload.password))
        db.add(user)
        db.commit()
        db.refresh(user)
    elif not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid dashboard credentials")
    return build_dashboard(db, user)
