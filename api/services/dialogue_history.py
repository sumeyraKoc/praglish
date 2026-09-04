from typing import Iterable, Protocol

from shared.schemas import DialogueTurn


class StoredDialogue(Protocol):
    speaker: str
    text: str
    is_natural: bool | None


def build_evaluator_history(
    dialogues: Iterable[StoredDialogue],
) -> list[DialogueTurn]:
    """Return every NPC message and only accepted user messages."""

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
    return history
