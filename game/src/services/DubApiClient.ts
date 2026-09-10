/**
 * "Sahneyi Seslendir" (Dub the Scene) ozelligi icin backend istemcisi.
 *
 * PraglishApiClient.ts'e kasitli olarak DAHIL EDILMEDI: o dosya tek
 * oyunculu oturum/kelime akisina (guest credentials, session_id, userId)
 * kenetli; bu ozellik ise tamamen kendi ekraninda calisan, veritabani
 * OLMAYAN ayri bir akis (bkz. api/routes/dub.py dosya basi aciklamasi).
 * Iki farkli sorumlulugu tek dosyada tutmak yerine ayri servis dosyasi
 * seciyoruz - projedeki mevcut "her ozellik kendi servisinde" alaniyla
 * tutarli.
 *
 * NOT: bu ozellik ONCE cok oyunculu (oda kur/katil, WebSocket) olarak
 * yapilmisti; proje kararlastirdi ki su an icin TEK KISILIK ilerlesin -
 * bu yuzden burada oda/soket YOK (coklu oyuncu surumune git gecmisinden
 * bakilabilir).
 */

const runtimeWindow = window as typeof window & { PRAGLISH_API_BASE_URL?: string };
const API_BASE_URL = (runtimeWindow.PRAGLISH_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class DubApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "DubApiError";
  }
}

export interface DubScriptLine {
  id: number;
  speaker: string;
  text: string;
  voice: string;
  // Sadece script gercek bir ses klibine dayaniyorsa (bkz. DubScript.audio_url)
  // dolu gelir - o zaman frontend TTS yerine bu ses dosyasinin
  // [start_seconds, end_seconds) araligini calar. end_seconds null ise klip
  // o repligin sonuna kadar (dogal bitisine kadar) oynatilmali.
  start_seconds?: number | null;
  end_seconds?: number | null;
}

export interface DubScript {
  id: string;
  title: string;
  characters: string[];
  lines: DubScriptLine[];
  // Doluysa (orn. "/assets/dub/charade-44.m4a") repliklerin sesi gercek bir
  // klipten geliyor demektir - bu yol OYUNUN (game) origin'inden servis
  // edilir, API_BASE_URL ile birlestirilmemeli. Bos ise repliklerin sesi
  // /api/speech/tts ile o an sentezlenir.
  audio_url?: string | null;
  // Doluysa (orn. "/assets/dub/charade-44.mp4") audio_url ile AYNI zaman
  // cizelgesini paylasan, SESSIZ (video icinde ses YOK) bir goruntu klibi
  // var demektir - karakterin agiz hareketlerini gostermek icin kullanilir,
  // gercek ses HER ZAMAN audio_url'den (veya TTS'ten) gelir; frontend bu
  // video elementini <video muted> olarak oynatmali. Bos ise video
  // gosterilmez, sadece ses ile calisilir.
  video_url?: string | null;
  // Sunucu tarafinda repliklerin kelimelerine bakarak hesaplanan 0-100
  // zorluk puani ve bu puana gore siralanmis 1'den baslayan seviye numarasi
  // (bkz. api/routes/dub.py _compute_difficulty_score). Yeni bir script
  // eklendiginde otomatik hesaplanip mevcutlarin arasina yerlesir.
  difficulty_score: number;
  level: number;
}

export interface WordVerdict {
  word: string;
  correct: boolean;
}

export interface ScoreLineResponse {
  transcript: string;
  expected: string;
  words: WordVerdict[];
  accuracy_percent: number;
}

export class DubApiClient {
  public async listScripts(): Promise<DubScript[]> {
    return this.getJson<DubScript[]>("/api/dub/scripts");
  }

  public async scoreLine(scriptId: string, lineId: number, audioBlob: Blob): Promise<ScoreLineResponse> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      const response = await fetch(
        `${API_BASE_URL}/api/dub/scripts/${scriptId}/lines/${lineId}/score`,
        { method: "POST", body: formData, signal: controller.signal },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new DubApiError(payload?.detail ?? `Scoring failed (${response.status})`, response.status);
      }
      return (await response.json()) as ScoreLineResponse;
    } catch (error: unknown) {
      if (error instanceof DubApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new DubApiError("Scoring took too long. Please try again.");
      }
      throw new DubApiError("Speech-to-text service is unavailable.");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  /** Bir replik icin sesi O AN Gemini TTS ile sentezler (bkz. dub.py: gercek klip yok, TTS var). */
  public async synthesizeLine(text: string, voice: string): Promise<Blob> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${API_BASE_URL}/api/speech/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new DubApiError(`Text-to-speech failed (${response.status})`, response.status);
      }
      return await response.blob();
    } catch (error: unknown) {
      if (error instanceof DubApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new DubApiError("Text-to-speech took too long.");
      }
      throw new DubApiError("Text-to-speech service is unavailable.");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      throw new DubApiError(payload?.detail ?? `Request failed (${response.status})`, response.status);
    }
    return (await response.json()) as T;
  }
}
