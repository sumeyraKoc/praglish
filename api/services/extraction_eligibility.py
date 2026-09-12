def should_extract_after_turn(previous_outcome: str | None) -> bool:

    return previous_outcome != "incorrect"
