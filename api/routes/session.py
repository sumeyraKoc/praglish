from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import hash_password, verify_password
from models.models import GameSession, User
from services.scenario_engine import ScenarioEngine

router = APIRouter()


class SessionStartRequest(BaseModel):
    username: str
    password: str
    location: str  # orn: "bakery" (aktif odalar: bakery, library)
    npc_role: str  # orn: "baker"


@router.post("/start")
def start_session(request: SessionStartRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == request.username).first()

    if user:
        # Kullanici var - sifreyi dogrula
        if not verify_password(request.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Incorrect password")
    else:
        # Kullanici yok - ayni endpoint kayit gorevi de goruyor (hackathon MVP icin)
        user = User(username=request.username, password_hash=hash_password(request.password))
        db.add(user)
        db.commit()
        db.refresh(user)

    initial_state = ScenarioEngine.get_initial_state(request.location)
    new_session = GameSession(
        user_id=user.id,
        location=request.location,
        npc_role=request.npc_role,
        scenario_state=initial_state,
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)

    return {
        "session_id": new_session.id,
        "user_id": user.id,
        "location": new_session.location,
        "npc_role": new_session.npc_role,
    }
