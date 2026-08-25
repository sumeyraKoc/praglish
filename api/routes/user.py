from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from core.database import get_db
from models.models import User

router = APIRouter()


class UserProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # SQLAlchemy nesnesinden direkt okunabilsin diye

    id: int
    username: str
    coins: int
    xp: int


@router.get("/{user_id}", response_model=UserProfileResponse)
def get_user_profile(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
