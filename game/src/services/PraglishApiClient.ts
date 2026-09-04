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
  probability_percent: number | null;
  evaluation_reason: string | null;
  rewards: RewardInfo | null;
}

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
  private sessionPromise: Promise<number> | null = null;
  private userId: number | null = null;

  constructor(private readonly config: PraglishSessionConfig = DEFAULT_SESSION_CONFIG) {}

  public startSession(): Promise<number> {
    if (!this.sessionPromise) {
      this.sessionPromise = this.createSession().catch((error: unknown) => {
        this.sessionPromise = null;
        throw error;
      });
    }
    return this.sessionPromise;
  }

  public async sendTurn(userText: string): Promise<TurnResponse> {
    const sessionId = await this.startSession();
    return this.request<TurnResponse>(`/api/session/${sessionId}/turn`, {
      user_text: userText,
    });
  }

  /**
   * Bir esyanin yaninda oyuncunun yazdigi/soyledigi kelimeyi backend'e gonderir.
   * Kelimenin dogru olup olmadigina, daha once kazanilip kazanilmadigina ve odul
   * miktarina backend (VocabularyEngine) karar verir - burada ikinci bir kelime
   * listesi tutmuyoruz, cift kaynak olusmasin diye.
   */
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

  /**
   * Bu odada oyuncunun daha once hangi concept/kelimeleri kazandigini getirir.
   * UI'da "already learned" rozetini gostermek ve gereksiz yeniden deneme
   * istemi vermemek icin sahne acilisinda bir kere cagrilip cache'lenmeli.
   */
  public async getVocabularyProgress(): Promise<VocabularyProgressEntry[]> {
    await this.startSession();
    if (this.userId === null) return [];
    return this.requestGet<VocabularyProgressEntry[]>(
      `/api/vocabulary/progress/${this.userId}/${this.config.location}`,
    );
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
      // headers/body sadece govdesi olan istekler icin set edilir; RequestInit'e
      // acikca `undefined` atamiyoruz (tsconfig'deki exactOptionalPropertyTypes
      // bunu reddeder), bunun yerine key'i hic eklemiyoruz.
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
