"""
Bu dosya aslinda api/services/dialogue_history.py'yi (api servisine ait bir
modul) test ediyordu ama yanlislikla ai/tests/ altina konmustu. ai container'i
Docker imajinda yalnizca ai/ (ve shared/) kodu bulunuyor - api/ kodu hic yok -
bu yuzden `docker compose exec ai python -m unittest discover -s tests`
calistirildiginda bu dosya `ModuleNotFoundError: No module named 'api'` ile
patliyordu ve butun ai test suite'ini FAILED yapiyordu.

Ayni testler artik dogru yerde: api/tests/test_dialogue_history.py (orada
api container'i icinde sorunsuz calisiyor, cunku `services.dialogue_history`
oradan direkt import edilebiliyor). Bu dosyayi tamamen silmek yerine (bu
oturumda dosya silme yetkim yok) kesfi (discovery) kirmayan zararsiz bir
skip'e cevirdim - yeni bir seye ihtiyaciniz yoksa bu dosyayi elle silip
gecebilirsiniz.
"""

import unittest


class DialogueHistoryTestsMoved(unittest.TestCase):
    def test_see_api_tests_test_dialogue_history(self) -> None:
        raise unittest.SkipTest(
            "Tasindi: bkz. api/tests/test_dialogue_history.py - bu modul "
            "api/services/dialogue_history.py'yi test ediyor, ai container'inda "
            "api/ kodu bulunmadigi icin buradan calisamaz."
        )


if __name__ == "__main__":
    unittest.main()
