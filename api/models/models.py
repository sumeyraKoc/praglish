from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    coins = Column(Integer, default=0)
    xp = Column(Integer, default=0)

    sessions = relationship("GameSession", back_populates="user")


class GameSession(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    location = Column(String)  # orn: "cafe", "hospital"
    npc_role = Column(String)  # orn: "barista", "doctor"
    scenario_state = Column(JSON, default=dict)  # dict, {} degil - mutable default tuzagi
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="sessions")
    dialogues = relationship("Dialogue", back_populates="session", cascade="all, delete")


class Dialogue(Base):
    """
    Not: SQLAlchemy modelinin adi bilerek 'DialogueTurn' degil 'Dialogue'.
    shared/schemas.py icinde LLM'e giden dialogue history icin zaten
    Pydantic tarafinda DialogueTurn adinda bir model var - ikisini ayni
    dosyada import etmek gerektiginde isim carpismasini onceden onluyoruz.
    """

    __tablename__ = "dialogues"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"))
    speaker = Column(String)  # "user" veya "npc"
    text = Column(String)

    # Language Evaluator'dan gelen sonuclar (sadece "user" satirlarinda dolu olur)
    is_natural = Column(Boolean, nullable=True)
    correction = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("GameSession", back_populates="dialogues")


class VocabularyProgress(Base):
    """
    Kullanicinin hangi kelime/es anlamliyi hangi konsept icin daha once
    kazandigini tutar. Ayni kelime icin iki kere odul verilmesini hem
    kod seviyesinde (routes/vocabulary.py) hem DB seviyesinde (UniqueConstraint)
    engelliyoruz.
    """

    __tablename__ = "vocabulary_progress"
    __table_args__ = (
        UniqueConstraint("user_id", "location", "concept", "word", name="uq_vocab_progress"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    location = Column(String)
    concept = Column(String)
    word = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
