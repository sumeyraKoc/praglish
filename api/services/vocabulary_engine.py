import json
import os
from typing import Any, Dict, Optional

VOCAB_DIR = os.path.join(os.path.dirname(__file__), "..", "game_data", "vocabulary")


class VocabularyEngine:
    @staticmethod
    def load_vocabulary(location: str) -> Dict[str, Any]:
        file_path = os.path.join(VOCAB_DIR, f"{location}.json")
        if not os.path.exists(file_path):
            # ScenarioEngine'deki ayni pattern: JSON'u olmayan oda icin
            # sessizce bos concept listesi don, hata firlatma.
            return {"location": location, "concepts": []}
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def find_concept(location: str, concept: str) -> Optional[dict]:
        data = VocabularyEngine.load_vocabulary(location)
        for c in data.get("concepts", []):
            if c["concept"] == concept:
                return c
        return None

    @staticmethod
    def match_word(concept_data: dict, submitted_word: str) -> Optional[dict]:
        normalized = submitted_word.strip().lower()
        for entry in concept_data.get("words", []):
            if entry["word"].strip().lower() == normalized:
                return entry
        return None
