
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
  start_seconds?: number | null;
  end_seconds?: number | null;
}

export interface DubScript {
  id: string;
  title: string;
  characters: string[];
  lines: DubScriptLine[];
  audio_url?: string | null;
  video_url?: string | null;
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
