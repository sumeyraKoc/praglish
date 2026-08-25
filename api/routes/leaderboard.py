from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from models.models import User

router = APIRouter()


@router.get("/")
def get_leaderboard(db: Session = Depends(get_db)):
    top_users = db.query(User).order_by(User.xp.desc()).limit(10).all()
    return [
        {"rank": i + 1, "username": u.username, "xp": u.xp, "coins": u.coins}
        for i, u in enumerate(top_users)
    ]
