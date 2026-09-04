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
    location = Column(String)  # aktif: "bakery", "library" (planlanan: "cafe", "hospital", "school")
    npc_role = Column(String)  # aktif: "baker", "librarian"
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
    speaker = Column(String)  # "user", "npc" veya "coach"; coach su an persist edilmez
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


class LearningExtractionEvent(Base):
    """Bir kullanici cumlesi icin ham ve denetlenebilir extractor sonucu."""

    __tablename__ = "learning_extraction_events"

    id = Column(Integer, primary_key=True, index=True)
    dialogue_id = Column(Integer, ForeignKey("dialogues.id"), unique=True, nullable=False)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    outcome = Column(String, nullable=False)  # correct / incorrect
    utterance = Column(String, nullable=False)
    raw_result = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class GrammarUsageStat(Base):
    __tablename__ = "grammar_usage_stats"
    __table_args__ = (
        UniqueConstraint("user_id", "outcome", "topic_id", name="uq_grammar_usage_stat"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    outcome = Column(String, nullable=False)
    topic_id = Column(Integer, nullable=False)
    topic_name = Column(String, nullable=False)
    count = Column(Integer, nullable=False, default=0)


class VocabularyLevelStat(Base):
    __tablename__ = "vocabulary_level_stats"
    __table_args__ = (
        UniqueConstraint("user_id", "outcome", "cefr_level", name="uq_vocabulary_level_stat"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    outcome = Column(String, nullable=False)
    cefr_level = Column(String, nullable=False)
    count = Column(Integer, nullable=False, default=0)


class VocabularyErrorTypeStat(Base):
    __tablename__ = "vocabulary_error_type_stats"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "error_type",
            name="uq_vocabulary_error_type_stat",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    error_type = Column(String, nullable=False)
    count = Column(Integer, nullable=False, default=0)


class IdiomUsageStat(Base):
    __tablename__ = "idiom_usage_stats"
    __table_args__ = (
        UniqueConstraint("user_id", "outcome", "normalized_idiom", name="uq_idiom_usage_stat"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    outcome = Column(String, nullable=False)
    normalized_idiom = Column(String, nullable=False)
    display_idiom = Column(String, nullable=False)
    count = Column(Integer, nullable=False, default=0)
    first_used_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
