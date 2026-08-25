class TextSpeechModule:
    """ Implementation for STT/TTS interface.

    Real STT and TTS services can later replace these two methods.
    No changes needed in other pipeline modules.
    """

    def speech_to_text(self, text_input: str) -> str:
        return text_input.strip()

    def text_to_speech(self, text: str) -> str:
        return text
