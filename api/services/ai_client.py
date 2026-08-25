import os

import httpx

from shared.schemas import EvaluateRequest, EvaluateResponse

AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai:8001")
USE_MOCK_AI = os.getenv("USE_MOCK_AI", "true").lower() == "true"


async def evaluate_and_respond(payload: EvaluateRequest) -> EvaluateResponse:
    """
    USE_MOCK_AI=true iken Sumeyra'nin ai servisini beklemeden
    Zehra sabit/sahte bir cevapla api tarafini gelistirebilir.
    Sumeyra ai servisini gercek Groq entegrasyonuyla doldurdukca
    USE_MOCK_AI=false yapip gercek servise gecilir.
    """
    if USE_MOCK_AI:
        return EvaluateResponse(
            accepted=False,
            correction="Could I get a coffee, please?",
            npc_response="Sure... do you mean 'Could I get a coffee, please?'",
            updated_scenario_state=payload.scenario_state,
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{AI_SERVICE_URL}/evaluate-and-respond",
            json=payload.model_dump(),
        )
        response.raise_for_status()
        return EvaluateResponse(**response.json())
