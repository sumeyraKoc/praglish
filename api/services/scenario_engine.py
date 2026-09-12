import json
import os
from typing import Any, Dict, Tuple

SCENARIOS_DIR = os.path.join(os.path.dirname(__file__), "..", "game_data", "scenarios")


class ScenarioEngine:
    @staticmethod
    def load_scenario(scenario_id: str) -> dict:
        file_path = os.path.join(SCENARIOS_DIR, f"{scenario_id}.json")
        if not os.path.exists(file_path):
            return {"initial_state": {}, "required_fields": [], "rewards": {}}

        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def get_initial_state(scenario_id: str) -> Dict[str, Any]:
        scenario_data = ScenarioEngine.load_scenario(scenario_id)
        return scenario_data.get("initial_state", {})

    @staticmethod
    def is_scenario_completed(scenario_id: str, current_state: Dict[str, Any]) -> Tuple[bool, dict]:
        scenario_data = ScenarioEngine.load_scenario(scenario_id)
        required_fields = scenario_data.get("required_fields", [])





        if not required_fields:
            return False, {}

        for field in required_fields:
            if current_state.get(field) is None:
                return False, {}

        return True, scenario_data.get("rewards", {})
