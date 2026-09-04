import os
from typing import Iterable, Protocol

from shared.schemas import DialogueTurn

# Bir turn'de evaluator + npc/correction icin 2 ardisik LLM cagrisi yapiliyor
# (bkz. ai/main.py > evaluate_and_respond). Konusma uzadikca dialogue_history
# de büyüyor ve her iki cagriya da her seferinde daha fazla token gonderiliyor
# - bu da (ozellikle uzun bir oda ziyaretinde) her turu kademeli olarak
# yavaslatan bir etken. Evaluator zaten yalnizca SON cumlenin baglama gore
# makul olup olmadigina bakiyor; NPC de "strictly in character, concise"
# calismasi icin tum gecmise degil son birkac degisime ihtiyac duyuyor - o
# yuzden gonderilen gecmisi son N turla sinirlamak (varsayilan 12 = ~6
# karsilikli konusma) yanit kalitesini gozle gorulur sekilde dusurmeden
# prompt boyutunu kucultuyor. Bunun disinda pipeline'in kendisi (Sumeyra'nin
# evaluator/correction/npc akisi) hic degismiyor.
MAX_DIALOGUE_HISTORY_TURNS = int(os.getenv("MAX_DIALOGUE_HISTORY_TURNS", "12"))


class StoredDialogue(Protocol):
    speaker: str
    text: str
    is_natural: bool | None


def build_evaluator_history(
    dialogues: Iterable[StoredDialogue],
    *,
    max_turns: int = MAX_DIALOGUE_HISTORY_TURNS,
) -> list[DialogueTurn]:
    """Return every NPC message and only accepted user messages.

    Only the most recent `max_turns` entries are kept (oldest ones dropped)
    to keep the prompt sent to the AI service from growing unbounded over a
    long room visit - see MAX_DIALOGUE_HISTORY_TURNS above. This only
    affects what gets sent to the evaluator/NPC/correction calls for THIS
    turn; nothing is deleted from the `dialogues` table itself, so learning
    analytics (extractor results) are unaffected.
    """

    history: list[DialogueTurn] = []
    skip_legacy_coach_message = False
    for dialogue in dialogues:
        if dialogue.speaker == "user":
            if dialogue.is_natural is True:
                history.append(DialogueTurn(speaker="user", text=dialogue.text))
                skip_legacy_coach_message = False
            else:
                # Eski surum reddedilen kullaniciyi ve coach mesajini "npc"
                # etiketiyle arka arkaya kaydediyordu. Bu eski coach satirini atla.
                skip_legacy_coach_message = True
        elif dialogue.speaker == "npc":
            if skip_legacy_coach_message:
                skip_legacy_coach_message = False
            else:
                history.append(DialogueTurn(speaker="npc", text=dialogue.text))
        elif dialogue.speaker == "coach":
            skip_legacy_coach_message = False

    if max_turns > 0 and len(history) > max_turns:
        history = history[-max_turns:]
    return history
