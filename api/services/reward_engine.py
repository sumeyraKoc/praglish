from sqlalchemy.orm import Session

from models.models import User


class RewardEngine:
    BASE_XP = 10
    NATURAL_BONUS_XP = 15
    NATURAL_BONUS_COIN = 5

    @staticmethod
    def process_turn_reward(db: Session, user_id: int, is_accepted: bool) -> dict | None:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return None

        gained_xp = RewardEngine.BASE_XP
        gained_coins = 0

        if is_accepted:
            gained_xp += RewardEngine.NATURAL_BONUS_XP
            gained_coins += RewardEngine.NATURAL_BONUS_COIN

        user.xp += gained_xp
        user.coins += gained_coins

        db.commit()
        db.refresh(user)

        return {
            "gained_xp": gained_xp,
            "gained_coins": gained_coins,
            "total_xp": user.xp,
            "total_coins": user.coins,
        }
