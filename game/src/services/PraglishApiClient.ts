const runtimeWindow = window as typeof window & { PRAGLISH_API_BASE_URL?: string };
const API_BASE_URL = (runtimeWindow.PRAGLISH_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

const STORAGE_KEY = "praglish.guest.credentials.v1";

interface GuestCredentials {
  username: string;
  password: string;
}

interface SessionStartResponse {
  session_id: number;
  user_id: number;
}

export interface RewardInfo {
  gained_xp: number;
  gained_coins: number;
  total_xp: number;
  total_coins: number;
}

export interface TurnResponse {
  accepted: boolean;
  correction: string | null;
  npc_response: string;
  response_speaker: "npc" | "coach";
  probability_percent: number | null;
  evaluation_reason: string | null;
  rewards: RewardInfo | null;
}

export interface TtsVoiceProfile {
  voice: string;
  style: string;
}

export const ROLEPLAY_TTS_PROFILES = {
  librarian: {
    voice: "Kore",
    style: "Speak naturally and warmly as a patient, knowledgeable female librarian at a relaxed conversational pace.",
  },
  cafeNpc: {
    voice: "Leda",
    style: "Speak as a sweet, cheerful young woman working in a cafe. Sound friendly, bright, and natural at a relaxed conversational pace.",
  },
  coach: {
    voice: "Gacrux",
    style: "Speak as a deep, resonant, mature older man. Sound calm, authoritative, strong, supportive, and very clear at a measured pace.",
  },
} as const satisfies Record<string, TtsVoiceProfile>;

export interface VocabularySubmitResponse {
  matched: boolean;
  already_earned: boolean;
  reward_coins: number;
  words_earned?: number;
  words_total?: number;
  concept_completed?: boolean;
  total_coins?: number;
}

export interface VocabularyProgressWord {
  word: string;
  earned: boolean;
}

export interface VocabularyProgressEntry {
  concept: string;
  words: VocabularyProgressWord[];
  completed: boolean;
}

export interface SpeechToTextResult {
  text: string;
  languageCode: string | null;
}

export interface DashboardData {
  profile: { user_id: number; username: string; xp: number; coins: number; level: number };
  summary: {
    total_turns: number;
    correct_turns: number;
    incorrect_turns: number;
    success_percent: number;
    words_learned: number;
    idioms_discovered: number;
  };
  weekly_activity: { date: string; correct: number; incorrect: number }[];
  locations: { name: string; turn_count: number }[];
  grammar_topics: {
    topic_id: number;
    topic_name: string;
    correct_count: number;
    incorrect_count: number;
    mastery_percent: number;
  }[];
  vocabulary_levels: { name: string; count: number }[];
  vocabulary_errors: { name: string; count: number }[];
  idioms: {
    normalized_idiom: string;
    display_idiom: string;
    correct_count: number;
    incorrect_count: number;
    last_used_at: string | null;
  }[];
}

export interface PraglishSessionConfig {
  location: string;
  npcRole: string;
  npcName: string;
}

const DEFAULT_SESSION_CONFIG: PraglishSessionConfig = {
  location: "bakery",
  npcRole: "baker",
  npcName: "Maya",
};

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export class PraglishApiClient {
  private static readonly instances = new Set<PraglishApiClient>();
  private sessionPromise: Promise<number> | null = null;
  private userId: number | null = null;

  constructor(private readonly config: PraglishSessionConfig = DEFAULT_SESSION_CONFIG) {
    PraglishApiClient.instances.add(this);
  }

  public static resetAllSessions(): void {
    PraglishApiClient.instances.forEach((client) => client.resetSession());
  }

  public startSession(): Promise<number> {
    if (!this.sessionPromise) {
      this.sessionPromise = this.createSession().catch((error: unknown) => {
        this.sessionPromise = null;
        throw error;
      });
    }
    return this.sessionPromise;
  }

  public resetSession(): void {
    this.sessionPromise = null;
  }

  public async sendTurn(userText: string): Promise<TurnResponse> {
    const sessionId = await this.startSession();
    return this.request<TurnResponse>(`/api/session/${sessionId}/turn`, {
      user_text: userText,
    });
  }

  public async submitVocabulary(concept: string, word: string): Promise<VocabularySubmitResponse> {
    await this.startSession();
    if (this.userId === null) {
      throw new ApiError("No active session yet - cannot submit vocabulary.");
    }
    return this.request<VocabularySubmitResponse>("/api/vocabulary/submit", {
      user_id: this.userId,
      location: this.config.location,
      concept,
      word,
    });
  }

  public async getVocabularyProgress(): Promise<VocabularyProgressEntry[]> {
    await this.startSession();
    if (this.userId === null) return [];
    return this.requestGet<VocabularyProgressEntry[]>(
      `/api/vocabulary/progress/${this.userId}/${this.config.location}`,
    );
  }

  public async getDashboard(): Promise<DashboardData> {
    return this.request<DashboardData>("/api/analytics/dashboard", this.getGuestCredentials());
  }

  public async transcribeAudio(audioBlob: Blob): Promise<SpeechToTextResult> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      const response = await fetch(`${API_BASE_URL}/api/speech/stt`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new ApiError(
          payload?.detail ?? `Speech-to-text failed (${response.status})`,
          response.status,
        );
      }
      const data = await response.json() as { text: string; language_code: string | null };
      return { text: data.text, languageCode: data.language_code };
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError("Speech recognition took too long. Please try again.");
      }
      throw new ApiError("Speech-to-text service is unavailable.");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  public async synthesizeSpeech(text: string, profile?: TtsVoiceProfile): Promise<Blob> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${API_BASE_URL}/api/speech/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile ? { text, ...profile } : { text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ApiError(`Text-to-speech failed (${response.status})`, response.status);
      }
      return await response.blob();
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError("Text-to-speech took too long.");
      }
      throw new ApiError("Text-to-speech service is unavailable.");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private async createSession(): Promise<number> {
    const credentials = this.getGuestCredentials();
    const response = await this.request<SessionStartResponse>("/api/session/start", {
      ...credentials,
      location: this.config.location,
      npc_role: this.config.npcRole,
    });
    this.userId = response.user_id;
    return response.session_id;
  }

  private async request<T>(path: string, body: object): Promise<T> {
    return this.performFetch<T>(path, { method: "POST", body });
  }

  private async requestGet<T>(path: string): Promise<T> {
    return this.performFetch<T>(path, { method: "GET" });
  }

  private async performFetch<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: object },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 125_000);
    try {
      const init: RequestInit = { method: options.method, signal: controller.signal };
      if (options.body !== undefined) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(options.body);
      }
      const response = await fetch(`${API_BASE_URL}${path}`, init);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new ApiError(payload?.detail ?? `API request failed (${response.status})`, response.status);
      }
      return await response.json() as T;
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError(`${this.config.npcName} took too long to answer. Please try again.`);
      }
      throw new ApiError("Backend is unavailable at localhost:8000.");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private getGuestCredentials(): GuestCredentials {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored) as GuestCredentials;
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const credentials = {
      username: `guest_${id}`,
      password: crypto.randomUUID(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
    return credentials;
  }
}
