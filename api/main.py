from fastapi import FastAPI

from core.database import Base, engine
from models import models  # noqa: F401 - Base.metadata'ya tablolari kaydettirmek icin import sart
from routes import leaderboard, session, turn, user, vocabulary

app = FastAPI(title="English World - API Service")

app.include_router(session.router, prefix="/api/session", tags=["session"])
app.include_router(turn.router, prefix="/api/session", tags=["turn"])
app.include_router(user.router, prefix="/api/user", tags=["user"])
app.include_router(leaderboard.router, prefix="/api/leaderboard", tags=["leaderboard"])
app.include_router(vocabulary.router, prefix="/api/vocabulary", tags=["vocabulary"])


@app.on_event("startup")
def on_startup():
    # Hackathon asamasinda create_all yeterli. Ticarilesme oncesi Alembic'e gecin
    # (gercek kullanici verisi varken tablo degisikligi icin migration gerekir).
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok", "service": "api"}
