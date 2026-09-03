import os

import httpx

from shared.schemas import (
    EvaluateRequest,
    EvaluateResponse,
    ExtractionRequest,
    ExtractionResult,
)

AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai:8001")
USE_MOCK_AI = os.getenv("USE_MOCK_AI", "true").lower() == "true"
AI_EVALUATION_TIMEOUT_SECONDS = float(
    os.getenv("AI_EVALUATION_TIMEOUT_SECONDS", "120")
)
AI_EXTRACTION_TIMEOUT_SECONDS = float(
    os.getenv("AI_EXTRACTION_TIMEOUT_SECONDS", "120")
)


async def evaluate_and_respond(payload: EvaluateRequest) -> EvaluateResponse:
    """
    USE_MOCK_AI=true iken Sumeyra'nin ai servisini beklemeden
    Zehra sabit/sahte bir cevapla api tarafini gelistirebilir.
    Sumeyra ai servisini gercek Groq entegrasyonuyla doldurdukca
    USE_MOCK_AI=false yapip gercek servise gecilir.
    """
    if USE_MOCK_AI:
        if payload.location == "library":
            return EvaluateResponse(
                accepted=False,
                correction="Could you help me find a mystery novel, please?",
                npc_response=(
                    "Of course. Try saying, "
                    "'Could you help me find a mystery novel, please?'"
                ),
                updated_scenario_state=payload.scenario_state,
            )
        return EvaluateResponse(
            accepted=False,
            correction="Could I get a coffee, please?",
            npc_response="Sure... do you mean 'Could I get a coffee, please?'",
            updated_scenario_state=payload.scenario_state,
        )

    async with httpx.AsyncClient(timeout=AI_EVALUATION_TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{AI_SERVICE_URL}/evaluate-and-respond",
            json=payload.model_dump(),
        )
        response.raise_for_status()
        return EvaluateResponse(**response.json())


async def extract_utterance(payload: ExtractionRequest) -> ExtractionResult | None:
    """Return None in mock mode so fake evaluations do not pollute analytics."""

    if USE_MOCK_AI:
        return None

    async with httpx.AsyncClient(timeout=AI_EXTRACTION_TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{AI_SERVICE_URL}/extract",
            json=payload.model_dump(),
        )
        response.raise_for_status()
        return ExtractionResult(**response.json())
