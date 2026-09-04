import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.database import Base, engine
from models import models  # noqa: F401 - Base.metadata'ya tablolari kaydettirmek icin import sart
from routes import leaderboard, session, speech, turn, user, vocabulary

logger = logging.getLogger("uvicorn.error")

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


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    FastAPI/Starlette olayi: bir route icinde beklenmeyen (HTTPException
    OLMAYAN) bir exception patladiginda, bu Starlette'in EN DISTAKI
    ServerErrorMiddleware'ine kadar cikar - ki o CORSMiddleware'in DISINDA
    oturuyor. Sonuc: 500 cevap CORS header'lari OLMADAN doner, ve tarayici
    gercek hatayi (ornegin bir SQL/500 hatasi) hic gostermeden "No
    'Access-Control-Allow-Origin' header is present" diye CORS hatasi
    gosterir - halbuki CORS ayari tamamen dogrudur.
    (Bu proje bunu yasadi: `users` tablosunda `password_hash` kolonu
    olmayan eski bir `pgdata` volume'u /api/session/start'ta 500'e
    sebep oluyordu, ama tarayicida "backend unavailable"/CORS hatasi gibi
    gorunuyordu - bkz. README "Sık karşılaşılan hatalar".)

    Bu handler'i eklemek exception'i FastAPI'nin normal exception-handling
    katmanina (CORSMiddleware'in ICINDE calisan ExceptionMiddleware) sokuyor,
    boylece CORS header'lari her zaman eklenir ve tarayici gercek 500'u
    gorur - "CORS hatasi" gibi gorunen baska bir backend hatasiyla tekrar
    saatlerce ugrasmayi onluyor.
    """

    logger.exception("Unhandled exception while handling %s", request.url, exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


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
