/**
 * "Sahneyi Seslendir" (Dub the Scene) ozelligi icin backend istemcisi.
 *
 * PraglishApiClient.ts'e kasitli olarak DAHIL EDILMEDI: o dosya tek
 * oyunculu oturum/kelime akisina (guest credentials, session_id, userId)
 * kenetli; bu ozellik ise oda kodu + oyuncu adiyla calisan, veritabani
 * OLMAYAN ayri bir akis (bkz. api/routes/dub.py dosya basi aciklamasi).
 * Iki farkli sorumlulugu tek dosyada tutmak yerine ayri servis dosyasi
 * seciyoruz - projedeki mevcut "her ozellik kendi servisinde" alaniyla
 * tutarli.
 */

const runtimeWindow = window as typeof window & { PRAGLISH_API_BASE_URL?: string };
const API_BASE_URL = (runtimeWindow.PRAGLISH_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws");

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
}

export interface DubScript {
  id: string;
  title: string;
  characters: string[];
  lines: DubScriptLine[];
}

export interface CreateRoomResponse {
  room_code: string;
  script: DubScript;
  player_token: string;
}

export interface RoomInfo {
  room_code: string;
  script_id: string;
  script_title: string;
  characters: string[];
  taken_characters: string[];
  state: "lobby" | "playing" | "finished";
  host_name: string;
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

/** Sunucudan gelen WebSocket mesajlarinin (bkz. dub.py) client tarafi sekli. */
export type DubServerMessage =
  | { type: "joined"; player_token: string }
  | {
      type: "room_state";
      state: "lobby" | "playing" | "finished";
      host_name: string;
      characters: string[];
      players: { name: string; character: string }[];
    }
  | {
      type: "turn";
      line_index: number;
      total_lines: number;
      line_id: number;
      speaker: string;
      for_you: boolean;
      text?: string;
      voice?: string;
      // Sadece script gercek bir ses klibine dayaniyorsa (bkz. dub.py
      // DubScript.audio_url) dolu gelir - o zaman frontend TTS yerine bu
      // ses dosyasinin [start_seconds, end_seconds) araligini calar.
      // end_seconds null ise klip o repliğin sonuna kadar (dogal bitisine
      // kadar) oynatilmali.
      audio_url?: string;
      start_seconds?: number;
      end_seconds?: number | null;
    }
  | {
      type: "finished";
      summary: {
        line_id: number;
        speaker: string;
        player_name: string;
        expected: string;
        transcript: string;
        accuracy_percent: number;
        words: WordVerdict[];
      }[];
    }
  | { type: "error"; detail: string };

export class DubApiClient {
  public async listScripts(): Promise<DubScript[]> {
    return this.getJson<DubScript[]>("/api/dub/scripts");
  }

  public async createRoom(hostName: string, scriptId = "sample-cafe"): Promise<CreateRoomResponse> {
    return this.postJson<CreateRoomResponse>("/api/dub/rooms", {
      host_name: hostName,
      script_id: scriptId,
    });
  }

  /**
   * Var olan bir odaya KOD ILE katilan oyuncunun hangi karakterleri secebilecegini
   * ogrenmesi icin - host'un o odayi hangi script'le actigini dogrudan sorar,
   * /api/dub/scripts listesinin ilk elemanini tahmin etmeye gerek birakmaz
   * (birden fazla script oldugunda bu tahmin yanlis cikiyordu).
   */
  public async getRoomInfo(roomCode: string): Promise<RoomInfo> {
    return this.getJson<RoomInfo>(`/api/dub/rooms/${roomCode}`);
  }

  /**
   * Oda WebSocket'ine baglanir. Baglanti acildiktan sonra "join" mesaji
   * GONDERILMEDEN oyuncu odaya eklenmez (bkz. dub.py room_socket) - yani
   * bu metod sadece soket acar, DubScene karakter secince join mesajini
   * ayrica yollar.
   */
  public connectRoom(roomCode: string): WebSocket {
    return new WebSocket(`${WS_BASE_URL}/api/dub/rooms/${roomCode}/ws`);
  }

  public async scoreLine(
    roomCode: string,
    lineId: number,
    playerToken: string,
    audioBlob: Blob,
  ): Promise<ScoreLineResponse> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      const response = await fetch(
        `${API_BASE_URL}/api/dub/rooms/${roomCode}/lines/${lineId}/score`,
        {
          method: "POST",
          headers: { "X-Player-Token": playerToken },
          body: formData,
          signal: controller.signal,
        },
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

  /** Bir oyuncunun kaydettigi replik sesini (baskalarinin "sahneyi izle" adiminda calmasi icin) getirir. */
  public lineAudioUrl(roomCode: string, lineId: number): string {
    return `${API_BASE_URL}/api/dub/rooms/${roomCode}/lines/${lineId}/audio`;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      throw new DubApiError(payload?.detail ?? `Request failed (${response.status})`, response.status);
    }
    return (await response.json()) as T;
  }

  private async postJson<T>(path: string, body: object): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      throw new DubApiError(payload?.detail ?? `Request failed (${response.status})`, response.status);
    }
    return (await response.json()) as T;
  }
}
