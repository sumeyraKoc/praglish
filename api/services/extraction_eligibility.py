def should_extract_after_turn(previous_outcome: str | None) -> bool:
    """Koctan hemen sonra tekrarlanan cumleyi ilerleme verisine katma.

    Mevcut akis kurali geregi ``incorrect`` bir tur koç cevabi uretir;
    ``correct`` bir tur ise NPC cevabi uretir. Ilk turda onceki sonuc yoktur
    ve oyuncunun cumlesi kendi uretimi kabul edilerek extractor'a verilir.
    """

    return previous_outcome != "incorrect"
