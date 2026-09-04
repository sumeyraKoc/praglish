import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.database import Base, engine
from models import models  # noqa: F401 - Base.metadata'ya tablolari kaydettirmek icin import sart
from routes import leaderboard, session, speech, turn, user, vocabulary

app = FastAPI(title="English World - API Service")

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(session.router, prefix="/api/session", tags=["session"])
app.include_router(turn.router, prefix="/api/session", tags=["turn"])
app.include_router(user.router, prefix="/api/user", tags=["user"])
app.include_router(leaderboard.router, prefix="/api/leaderboard", tags=["leaderboard"])
app.include_router(vocabulary.router, prefix="/api/vocabulary", tags=["vocabulary"])
app.include_router(speech.router, prefix="/api/speech", tags=["speech"])


@app.on_event("startup")
def on_startup():
    # Hackathon asamasinda create_all yeterli. Ticarilesme oncesi Alembic'e gecin
    # (gercek kullanici verisi varken tablo degisikligi icin migration gerekir).
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok", "service": "api"}
