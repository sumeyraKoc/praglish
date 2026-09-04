const runtimeWindow = window as typeof window & { PRAGLISH_API_BASE_URL?: string };
const API_BASE_URL = (runtimeWindow.PRAGLISH_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

const STORAGE_KEY = "praglish.guest.credentials.v1";

interface GuestCredentials {
  username: string;
  password: string;
}

interface SessionStartResponse {
  session_id: number;
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

  private async createSession(): Promise<number> {
    const credentials = this.getGuestCredentials();
    const response = await this.request<SessionStartResponse>("/api/session/start", {
      ...credentials,
      location: this.config.location,
      npc_role: this.config.npcRole,
    });
    return response.session_id;
  }

  private async request<T>(path: string, body: object): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 125_000);
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
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
