import Phaser from "phaser";
import { DubApiClient, DubApiError, DubScript, DubScriptLine, WordVerdict } from "../services/DubApiClient";


type Screen = "start" | "your-turn" | "other-turn" | "finished" | "journal";

interface SummaryEntry {
  line: DubScriptLine;
  words: WordVerdict[];
  accuracy_percent: number;
}

const RECORDING_AUTO_STOP_MS = 12_000;
// nerede oldugunu net duyuyor.
const DUCK_VOLUME = 0.12;

// ---------------------------------------------------------------------
// tutulmuyor.)
const NOTE_IMAGES = [
  "/assets/dub/ui/note1.png",
  "/assets/dub/ui/note2.png",
  "/assets/dub/ui/note3.png",
  "/assets/dub/ui/note4.png",
] as const;
const SCRIPT_NOTE_INDEX: Record<string, number> = {
  "charade-44": 1, // buyutec - casusluk/gerilim sahnesi
  "superman-caverns": 3, // roket - bilim-kurgu/superkahraman
  "notld-cemetery": 2, // orumcek agi - korku sahnesi
  "gulliver-wedding": 0, // duz kagit - masalsi macera
};
function noteAssetForScript(scriptId: string, index: number): { url: string; variant: number } {
  const noteIndex = SCRIPT_NOTE_INDEX[scriptId] ?? index % NOTE_IMAGES.length;
  return { url: NOTE_IMAGES[noteIndex]!, variant: noteIndex + 1 };
}
const CHARACTER_PILL_COLORS = ["#6bbf6b", "#e0668f", "#e8a23c", "#8f7ae0", "#4fb8c9"] as const;
function characterPillColor(index: number): string {
  return CHARACTER_PILL_COLORS[index % CHARACTER_PILL_COLORS.length]!;
}

// ---------------------------------------------------------------------
const STUDIO_BG_URL = "/assets/dub/ui/studio-bg.jpg";

const ICON_REPLAY =
  '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"/></svg>';
const ICON_MIC =
  '<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const ICON_CONTINUE = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5Z"/></svg>';

function bannerText(text: string): string {
  return text.toUpperCase();
}

export class DubScene extends Phaser.Scene {
  private readonly api = new DubApiClient();

  private panel: Phaser.GameObjects.DOMElement | null = null;
  private statusEl: HTMLElement | null = null;
  private screen: Screen = "start";

  private availableScripts: DubScript[] = [];
  private levelsEl: HTMLElement | null = null;
  private helpOutsideClickHandler: ((event: MouseEvent) => void) | null = null;

  private script: DubScript | null = null;
  private myCharacter = "";
  private lineIndex = 0;
  private summary: SummaryEntry[] = [];

  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private recordAutoStopHandle: number | null = null;
  private recordedAudio = new Map<number, Blob>();

  private currentAudio: HTMLAudioElement | null = null;
  private playbackAbort = false;
  private videoEl: HTMLVideoElement | null = null;

  private turnFeedbackEl: HTMLElement | null = null;
  private turnRecordBtn: HTMLButtonElement | null = null;
  private turnContinueBtn: HTMLButtonElement | null = null;
  private pendingContinueAction: (() => void) | null = null;

  constructor() {
    super("DubScene");
  }

  public create(): void {
    this.screen = "start";
    this.renderStart();
    void this.loadScripts();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  private async loadScripts(): Promise<void> {
    try {
      const scripts = await this.api.listScripts();
      this.availableScripts = [...scripts].sort((a, b) => a.level - b.level);
      if (this.screen !== "start") return; // the user may have already left this screen
      this.renderLevelMap();
    } catch {
      this.availableScripts = [];
      if (this.screen === "start") {
        this.setStatus("Scenes could not be loaded. Is the server running? Refresh the page and try again.", true);
      }
    }
  }

  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------

  private static readonly COMPLETION_KEY = "praglish.dub.completion.v1";
  private static readonly LAST_CHARACTER_KEY = "praglish.dub.lastCharacter.v1";

  private loadCompletionStore(): Record<string, Record<string, number>> {
    try {
      const raw = window.localStorage.getItem(DubScene.COMPLETION_KEY);
      return raw ? (JSON.parse(raw) as Record<string, Record<string, number>>) : {};
    } catch {
      return {};
    }
  }

  private saveCompletionStore(store: Record<string, Record<string, number>>): void {
    try {
      window.localStorage.setItem(DubScene.COMPLETION_KEY, JSON.stringify(store));
    } catch {
    }
  }

  private getCharacterCompletion(scriptId: string, character: string): number | null {
    const store = this.loadCompletionStore();
    const scriptEntry = store[scriptId];
    if (!scriptEntry) return null;
    const value = scriptEntry[character];
    return value === undefined ? null : value;
  }

  private recordCharacterCompletion(scriptId: string, character: string, averageAccuracy: number): void {
    const store = this.loadCompletionStore();
    const scriptEntry = store[scriptId] ?? {};
    scriptEntry[character] = averageAccuracy;
    store[scriptId] = scriptEntry;
    this.saveCompletionStore(store);
  }

  private getLastCharacter(scriptId: string, fallback: string): string {
    try {
      const raw = window.localStorage.getItem(DubScene.LAST_CHARACTER_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      return map[scriptId] ?? fallback;
    } catch {
      return fallback;
    }
  }

  private recordLastCharacter(scriptId: string, character: string): void {
    try {
      const raw = window.localStorage.getItem(DubScene.LAST_CHARACTER_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      map[scriptId] = character;
      window.localStorage.setItem(DubScene.LAST_CHARACTER_KEY, JSON.stringify(map));
    } catch {
    }
  }

  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------

  private renderLevelMap(): void {
    if (!this.levelsEl) return;
    if (this.availableScripts.length === 0) {
      this.levelsEl.innerHTML = `<p class="dialogue-status">No scenes have been added yet.</p>`;
      return;
    }

    this.levelsEl.innerHTML = this.availableScripts
      .map((script, index) => this.renderLevelItemHtml(script, index))
      .join("");

    this.levelsEl.querySelectorAll("[data-action='pick-character']").forEach((el) => {
      el.addEventListener("click", () => {
        const button = el as HTMLElement;
        const scriptId = button.dataset["script"];
        const character = button.dataset["character"];
        if (!scriptId || !character) return;
        const script = this.availableScripts.find((s) => s.id === scriptId);
        if (!script) return;
        this.recordLastCharacter(scriptId, character);
        this.startScene(script, character);
      });
    });
  }

  private renderLevelItemHtml(script: DubScript, index: number): string {
    const charsHtml = script.characters
      .map(
        (c, charIndex) =>
          `<button type="button" class="dub-char-pill" style="--pill-color:${characterPillColor(charIndex)}" data-action="pick-character" data-script="${this.escapeHtml(script.id)}" data-character="${this.escapeHtml(c)}">${this.escapeHtml(c)}</button>`,
      )
      .join("");

    const note = noteAssetForScript(script.id, index);
    const displayTitle = this.escapeHtml(script.title.toUpperCase());

    return `
      <div class="dub-note-card" data-note-variant="${note.variant}" style="background-image:url('${note.url}')">
        <div class="dub-note-content">
          <div class="dub-note-title">${displayTitle}</div>
          <div class="dub-note-chars">${charsHtml}</div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------

  private teardown(): void {
    this.setScreenBackdrop(null);
    this.playbackAbort = true;
    this.stopCurrentAudio();
    this.clearRecordAutoStop();
    if (this.isRecording) this.mediaRecorder?.stop();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    if (this.helpOutsideClickHandler) {
      document.removeEventListener("click", this.helpOutsideClickHandler);
      this.helpOutsideClickHandler = null;
    }
    this.panel?.destroy();
    this.panel = null;
  }

  private exitToLevelSelect(): void {
    this.playbackAbort = true;
    this.stopCurrentAudio();
    this.clearRecordAutoStop();
    if (this.isRecording) {
      this.isRecording = false;
      this.mediaRecorder?.stop();
    }
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.resetState();
    this.renderStart();
  }

  private exitToMenu(): void {
    this.teardown();
    this.scene.start("MenuScene");
  }

  private setStatus(text: string, isError = false): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("dub-status-error", isError);
  }

  private mount(html: string, onExit: () => void = () => this.exitToMenu()): HTMLElement {
    this.panel?.destroy();
    const dom = this.add.dom(640, 360).createFromHTML(html);
    this.panel = dom;
    const node = dom.node as HTMLElement;
    const backdrop = node.querySelector(".dub-panel--levels")
      ? "levels"
      : node.querySelector(".dub-panel--studio")
        ? "studio"
        : null;
    this.setScreenBackdrop(backdrop);
    this.statusEl = node.querySelector('[data-role="status"]');
    const closeBtn = node.querySelector('[data-action="exit"]');
    closeBtn?.addEventListener("click", () => onExit());
    return node;
  }

  private setScreenBackdrop(backdrop: "levels" | "studio" | null): void {
    document.body.classList.toggle("dub-levels-backdrop", backdrop === "levels");
    document.body.classList.toggle("dub-studio-backdrop", backdrop === "studio");
    this.cameras.main.setBackgroundColor(backdrop ? "rgba(0, 0, 0, 0)" : "#15111f");
  }

  private setupVideoElement(node: HTMLElement, dataRole: string): void {
    const video = node.querySelector(`[data-role="${dataRole}"]`) as HTMLVideoElement | null;
    if (!video) {
      this.videoEl = null;
      return;
    }
    const videoUrl = this.script?.video_url;
    if (!videoUrl) {
      video.style.display = "none";
      this.videoEl = null;
      return;
    }
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    this.videoEl = video;
  }

  private playVideoRange(start: number, end: number | null): void {
    const video = this.videoEl;
    if (!video) return;
    const onTimeUpdate = (): void => {
      if (end !== null && video.currentTime >= end) {
        video.pause();
        video.removeEventListener("timeupdate", onTimeUpdate);
      }
    };
    if (end !== null) video.addEventListener("timeupdate", onTimeUpdate);
    const startPlayback = (): void => {
      video.currentTime = start;
      video.play().catch(() => {
      });
    };
    if (video.readyState >= 1) {
      startPlayback();
    } else {
      video.addEventListener("loadedmetadata", startPlayback, { once: true });
    }
  }

  private stopVideoElement(): void {
    if (this.videoEl) this.videoEl.pause();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof DubApiError) return error.message;
    if (error instanceof Error) return error.message;
    return fallback;
  }

  private resetState(): void {
    this.script = null;
    this.myCharacter = "";
    this.lineIndex = 0;
    this.summary = [];
    this.recordedAudio.clear();
    this.videoEl = null;
  }

  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------

  private renderStart(): void {
    this.screen = "start";
    const node = this.mount(`
      <div class="dialogue-panel dub-panel dub-panel--levels">
        <div class="dub-levels-header">
          <button type="button" class="dub-wood-btn dub-wood-btn--back" data-action="exit" aria-label="Go back">BACK</button>
          <div class="dub-wood-banner">LISTEN &amp; REPEAT</div>
          <button type="button" class="dub-help-icon dub-journal-icon" data-action="open-journal" aria-label="Progress Journal" title="Progress Journal">&#128214;</button>
          <div class="dub-help" data-role="help">
            <button type="button" class="dub-help-icon" data-action="toggle-help" aria-label="Help">?</button>
            <div class="dub-help-tooltip" role="tooltip">
              <strong>Dub the Scene</strong>
              Choose a level, then select the character you want to perform.
            </div>
          </div>
        </div>
        <div class="dialogue-status dub-levels-status" data-role="status"></div>
        <div class="dub-body dub-levels-body">
          <div class="dub-levels" data-role="levels"><p class="dialogue-status">Loading...</p></div>
        </div>
      </div>
    `);

    node.querySelector('[data-action="open-journal"]')?.addEventListener("click", () => this.renderJournal());

    const helpEl = node.querySelector('[data-role="help"]') as HTMLElement | null;
    const helpToggle = node.querySelector('[data-action="toggle-help"]');
    helpToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      helpEl?.classList.toggle("open");
    });
    if (this.helpOutsideClickHandler) {
      document.removeEventListener("click", this.helpOutsideClickHandler);
    }
    this.helpOutsideClickHandler = (event: MouseEvent) => {
      if (!helpEl || !helpEl.classList.contains("open")) return;
      if (event.target instanceof Node && !helpEl.contains(event.target)) {
        helpEl.classList.remove("open");
      }
    };
    document.addEventListener("click", this.helpOutsideClickHandler);

    this.levelsEl = node.querySelector('[data-role="levels"]') as HTMLElement;
    if (this.availableScripts.length > 0) this.renderLevelMap();
  }

  // ---------------------------------------------------------------------
  // Journal shell (.progress-dashboard/.progress-header/.paper-close/.paper-book/
  // ---------------------------------------------------------------------

  private renderJournal(): void {
    this.screen = "journal";
    const store = this.loadCompletionStore();
    const scripts = this.availableScripts;

    const allCompletions: number[] = [];
    let completedCharacterCount = 0;
    for (const script of scripts) {
      for (const character of script.characters) {
        const value = store[script.id]?.[character];
        if (value !== undefined) {
          allCompletions.push(value);
          completedCharacterCount += 1;
        }
      }
    }
    const scriptsStarted = scripts.filter((script) =>
      script.characters.some((character) => store[script.id]?.[character] !== undefined),
    ).length;
    const averageAccuracy = allCompletions.length
      ? Math.round(allCompletions.reduce((sum, value) => sum + value, 0) / allCompletions.length)
      : 0;
    const bestAccuracy = allCompletions.length ? Math.round(Math.max(...allCompletions)) : 0;

    const overviewHtml = `
      <div class="paper-stat-grid">
        <div><span>SCENARIOS ATTEMPTED</span><strong>${scriptsStarted}/${scripts.length}</strong></div>
        <div><span>CHARACTERS COMPLETED</span><strong>${completedCharacterCount}</strong></div>
        <div><span>AVERAGE ACCURACY</span><strong>${averageAccuracy}%</strong></div>
        <div><span>BEST RESULT</span><strong>${bestAccuracy}%</strong></div>
      </div>
    `;

    const scriptsHtml = scripts.length
      ? scripts
          .map((script) => {
            const rows = script.characters
              .map((character) => {
                const value = store[script.id]?.[character];
                const tried = value !== undefined;
                const pct = tried ? Math.round(value) : 0;
                const label = tried ? `%${pct}` : "&mdash;";
                return `
                  <div class="paper-meter${tried ? "" : " muted"}">
                    <span>${this.escapeHtml(character)}</span>
                    <i><b style="width:${pct}%"></b></i>
                    <strong>${label}</strong>
                  </div>
                `;
              })
              .join("");
            return `<div class="journal-script"><b>${this.escapeHtml(script.title)}</b>${rows}</div>`;
          })
          .join("")
      : `<div class="paper-empty">No scenarios have been loaded yet.</div>`;

    this.mount(
      `
      <section class="progress-dashboard dub-journal-dashboard" aria-label="Progress journal">
        <header class="progress-header">
          <div><strong>PRAGLISH JOURNAL</strong><span>MY LEARNING ADVENTURE</span></div>
          <button type="button" class="paper-close" data-action="exit">CLOSE</button>
        </header>
        <div class="paper-book">
          <section class="paper-page left">
            <h1>SUMMARY</h1>
            <div class="paper-scroll">${overviewHtml}</div>
          </section>
          <div class="book-spine"></div>
          <section class="paper-page right">
            <h1>SCENARIOS</h1>
            <div class="paper-scroll">${scriptsHtml}</div>
          </section>
        </div>
      </section>
    `,
      () => this.renderStart(),
    );
  }

  private startScene(script: DubScript, character: string): void {
    this.script = script;
    this.myCharacter = character;
    this.lineIndex = 0;
    this.summary = [];
    this.recordedAudio.clear();
    this.videoEl = null;
    this.advanceLine();
  }

  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------

  private advanceLine(): void {
    if (!this.script) return;
    if (this.lineIndex >= this.script.lines.length) {
      this.renderFinished();
      return;
    }
    const line = this.script.lines[this.lineIndex];
    if (!line) {
      this.renderFinished();
      return;
    }
    if (line.speaker === this.myCharacter) {
      this.renderYourTurn(line);
    } else {
      this.renderOtherTurn(line);
    }
  }

  private playReferenceForLine(line: DubScriptLine, volume: number): Promise<void> {
    if (this.script?.audio_url && line.start_seconds !== undefined && line.start_seconds !== null) {
      return this.playAudioSegment(this.script.audio_url, line.start_seconds, line.end_seconds ?? null, volume);
    }
    return this.playLine(line.text, line.voice, volume);
  }

  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------

  private renderYourTurn(line: DubScriptLine): void {
    this.screen = "your-turn";
    const total = this.script!.lines.length;
    const node = this.mount(`
      <div class="dialogue-panel dub-panel dub-panel--studio">
        <div class="dialogue-status dub-studio-status" data-role="status">${this.escapeHtml(this.myCharacter)}: Listening to your line...</div>
        <div class="dub-studio-stage">
          <div class="dub-studio-tag">Line ${this.lineIndex + 1}/${total}</div>
          <video class="dub-studio-video" data-role="line-video" muted playsinline></video>
          <div class="dub-studio-feedback" data-role="line-feedback" hidden></div>
          <button type="button" class="dub-console-btn dub-console-btn--back" data-action="exit" title="Go back" aria-label="Go back">BACK</button>
          <button type="button" class="dub-console-btn dub-console-btn--replay" data-action="replay" title="Listen again" aria-label="Listen again">${ICON_REPLAY}</button>
          <button type="button" class="dub-console-btn dub-console-btn--record" data-action="record" data-role="record-btn" disabled title="Start recording" aria-label="Start recording">${ICON_MIC}</button>
          <button type="button" class="dub-console-btn dub-console-btn--continue" data-action="continue" data-role="continue-btn" disabled title="Continue" aria-label="Continue">${ICON_CONTINUE}</button>
        </div>
      </div>
    `,
      () => this.exitToLevelSelect(),
    );

    this.setupVideoElement(node, "line-video");

    const replayBtn = node.querySelector('[data-action="replay"]') as HTMLButtonElement;
    const recordBtn = node.querySelector('[data-role="record-btn"]') as HTMLButtonElement;
    const continueBtn = node.querySelector('[data-role="continue-btn"]') as HTMLButtonElement;
    this.turnFeedbackEl = node.querySelector('[data-role="line-feedback"]') as HTMLElement;
    this.turnRecordBtn = recordBtn;
    this.turnContinueBtn = continueBtn;
    this.pendingContinueAction = null;

    const playReference = (): Promise<void> => this.playReferenceForLine(line, 1);

    replayBtn.addEventListener("click", () => {
      void playReference();
    });
    recordBtn.addEventListener("click", () => {
      if (this.isRecording) {
        this.finishRecording();
      } else {
        void this.startRecording();
      }
    });
    continueBtn.addEventListener("click", () => {
      if (continueBtn.disabled) return;
      continueBtn.disabled = true;
      const action = this.pendingContinueAction;
      this.pendingContinueAction = null;
      action?.();
    });

    void playReference().then(() => {
      recordBtn.disabled = false;
      this.setStatus(`${this.myCharacter}: Now repeat the line and start recording.`);
    });
  }

  private async playLine(text: string, voice: string, volume = 1): Promise<void> {
    this.stopCurrentAudio();
    try {
      const blob = await this.api.synthesizeLine(text, voice);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = volume;
      this.currentAudio = audio;
      await new Promise<void>((resolve) => {
        audio.addEventListener("ended", () => resolve(), { once: true });
        audio.addEventListener("error", () => resolve(), { once: true });
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
    } catch {
      this.setStatus("Audio could not be prepared, but you can still repeat the line.");
    }
  }

  private async playRecordedBlob(
    blob: Blob,
    volume = 1,
    videoRange?: { start: number; end: number | null },
  ): Promise<void> {
    this.stopCurrentAudio();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = volume;
    this.currentAudio = audio;
    if (videoRange) this.playVideoRange(videoRange.start, videoRange.end);
    await new Promise<void>((resolve) => {
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener("error", () => resolve(), { once: true });
      audio.play().catch(() => resolve());
    });
    if (videoRange) this.stopVideoElement();
    URL.revokeObjectURL(url);
  }

  private async playAudioSegment(url: string, start: number, end: number | null, volume = 1): Promise<void> {
    this.stopCurrentAudio();
    const audio = new Audio(url);
    audio.volume = volume;
    this.currentAudio = audio;
    this.playVideoRange(start, end);

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        audio.removeEventListener("timeupdate", onTimeUpdate);
        audio.removeEventListener("ended", finish);
        audio.removeEventListener("error", finish);
        audio.pause();
        this.stopVideoElement();
        resolve();
      };
      const onTimeUpdate = (): void => {
        if (end !== null && audio.currentTime >= end) finish();
      };
      const startPlayback = (): void => {
        audio.currentTime = start;
        audio.play().catch(() => finish());
      };
      audio.addEventListener("timeupdate", onTimeUpdate);
      audio.addEventListener("ended", finish, { once: true });
      audio.addEventListener("error", finish, { once: true });
      if (audio.readyState >= 1) {
        startPlayback();
      } else {
        audio.addEventListener("loadedmetadata", startPlayback, { once: true });
      }
    });
  }

  private stopCurrentAudio(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
  }

  private async startRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus("This browser does not support microphone recording.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaStream = stream;
      const recorder = new MediaRecorder(stream);
      this.audioChunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        void this.submitRecording();
      });
      this.mediaRecorder = recorder;
      recorder.start();
      this.isRecording = true;
      this.setStatus("Recording... press the button again when you are finished.");
      if (this.turnRecordBtn) {
        this.turnRecordBtn.innerHTML = ICON_STOP;
        this.turnRecordBtn.title = "Stop recording";
        this.turnRecordBtn.setAttribute("aria-label", "Stop recording");
        this.turnRecordBtn.classList.add("recording");
      }
      this.recordAutoStopHandle = window.setTimeout(() => this.finishRecording(), RECORDING_AUTO_STOP_MS);
    } catch {
      this.setStatus("Microphone permission was not granted.");
    }
  }

  private clearRecordAutoStop(): void {
    if (this.recordAutoStopHandle !== null) {
      window.clearTimeout(this.recordAutoStopHandle);
      this.recordAutoStopHandle = null;
    }
  }

  private finishRecording(): void {
    this.clearRecordAutoStop();
    if (!this.isRecording) return;
    this.isRecording = false;
    this.mediaRecorder?.stop();
    if (this.turnRecordBtn) {
      this.turnRecordBtn.innerHTML = ICON_MIC;
      this.turnRecordBtn.title = "Start recording";
      this.turnRecordBtn.setAttribute("aria-label", "Start recording");
      this.turnRecordBtn.classList.remove("recording");
      this.turnRecordBtn.disabled = true;
    }
  }

  private async submitRecording(): Promise<void> {
    const script = this.script;
    if (!script) return;
    const line = script.lines[this.lineIndex];
    if (!line) return; // defensive guard; this index should normally be valid
    const recordedType = this.mediaRecorder?.mimeType || "audio/webm";
    const blob = new Blob(this.audioChunks, { type: recordedType });
    this.audioChunks = [];
    if (blob.size === 0) {
      this.setStatus("Audio could not be recorded. Try again.");
      if (this.turnRecordBtn) this.turnRecordBtn.disabled = false;
      return;
    }
    this.recordedAudio.set(line.id, blob);
    this.setStatus("Evaluating...");
    try {
      const result = await this.api.scoreLine(script.id, line.id, blob);
      this.renderLineFeedback(line, result.words, result.accuracy_percent);
    } catch (error: unknown) {
      this.setStatus(this.describeError(error, "Evaluation failed."));
      if (this.turnRecordBtn) this.turnRecordBtn.disabled = false;
    }
  }

  private renderLineFeedback(line: DubScriptLine, words: WordVerdict[], accuracy: number): void {
    const feedbackEl = this.turnFeedbackEl;
    if (feedbackEl) {
      const wordsHtml = words
        .map((w) => `<span class="dub-word ${w.correct ? "correct" : "wrong"}">${this.escapeHtml(w.word)}</span>`)
        .join("");
      feedbackEl.innerHTML = `
        <div>${wordsHtml}</div>
        <div class="dub-turn-indicator">Accuracy: ${accuracy}%</div>
      `;
      feedbackEl.hidden = false;
    }
    if (this.turnRecordBtn) this.turnRecordBtn.disabled = true;
    if (this.turnContinueBtn) this.turnContinueBtn.disabled = false;
    this.pendingContinueAction = () => {
      this.summary.push({ line, words, accuracy_percent: accuracy });
      this.lineIndex += 1;
      this.advanceLine();
    };
    this.setStatus("Complete.");
  }

  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------

  private renderOtherTurn(line: DubScriptLine): void {
    this.screen = "other-turn";
    const total = this.script!.lines.length;
    const node = this.mount(`
      <div class="dialogue-panel dub-panel dub-panel--studio">
        <div class="dialogue-status dub-studio-status" data-role="status">${this.escapeHtml(line.speaker)}: Listening...</div>
        <div class="dub-studio-caption">&ldquo;${this.escapeHtml(line.text)}&rdquo;</div>
        <div class="dub-studio-stage">
          <div class="dub-studio-tag">Line ${this.lineIndex + 1}/${total}</div>
          <video class="dub-studio-video" data-role="line-video" muted playsinline></video>
          <button type="button" class="dub-console-btn dub-console-btn--back" data-action="exit" title="Go back" aria-label="Go back">BACK</button>
          <button type="button" class="dub-console-btn dub-console-btn--replay" data-action="replay" title="Listen again" aria-label="Listen again">${ICON_REPLAY}</button>
          <button type="button" class="dub-console-btn dub-console-btn--continue" data-action="continue" disabled title="Continue" aria-label="Continue">${ICON_CONTINUE}</button>
        </div>
      </div>
    `,
      () => this.exitToLevelSelect(),
    );

    this.setupVideoElement(node, "line-video");

    const replayBtn = node.querySelector('[data-action="replay"]') as HTMLButtonElement;
    const continueBtn = node.querySelector('[data-action="continue"]') as HTMLButtonElement;

    const playReference = (): Promise<void> => this.playReferenceForLine(line, 1);

    replayBtn.addEventListener("click", () => {
      void playReference();
    });
    continueBtn.addEventListener("click", () => {
      if (continueBtn.disabled) return;
      this.lineIndex += 1;
      this.advanceLine();
    });

    void playReference().then(() => {
      continueBtn.disabled = false;
      this.setStatus("Press the button to continue.");
    });
  }

  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------

  private renderFinished(): void {
    this.screen = "finished";
    this.playbackAbort = true;

    if (this.script && this.summary.length > 0) {
      const averageAccuracy = Math.round(
        this.summary.reduce((sum, entry) => sum + entry.accuracy_percent, 0) / this.summary.length,
      );
      this.recordCharacterCompletion(this.script.id, this.myCharacter, averageAccuracy);
    }

    const linesHtml = this.summary
      .map((entry) => {
        const wordsHtml = entry.words
          .map((w) => `<span class="dub-word ${w.correct ? "correct" : "wrong"}">${this.escapeHtml(w.word)}</span>`)
          .join("");
        return `
          <div class="dub-summary-line">
            <strong>${this.escapeHtml(entry.line.speaker)}</strong> - %${entry.accuracy_percent}
            <div>${wordsHtml}</div>
          </div>
        `;
      })
      .join("");

    const node = this.mount(`
      <div class="dialogue-panel dub-panel">
        <div class="dialogue-header">
          <strong>Scene complete!</strong>
          <span>How did your performance as ${this.escapeHtml(this.myCharacter)} go?</span>
          <button type="button" class="dialogue-close" data-action="exit" aria-label="Close">x</button>
        </div>
        <div class="dialogue-status" data-role="status">Review your lines below or listen to the full scene.</div>
        <video class="dub-video" data-role="line-video" muted playsinline></video>
        <div class="dub-body" data-role="summary-list">${linesHtml || "<p>No recorded lines.</p>"}</div>
        <div class="dub-row" style="margin-top:10px;">
          <button type="button" class="dub-btn" data-action="play-all">Play Full Scene</button>
          <button type="button" class="dub-btn secondary" data-action="restart">Start Again</button>
        </div>
      </div>
    `);

    this.setupVideoElement(node, "line-video");

    const playAllBtn = node.querySelector('[data-action="play-all"]') as HTMLButtonElement;
    playAllBtn.addEventListener("click", () => {
      void this.playFullScene();
    });

    const restartBtn = node.querySelector('[data-action="restart"]') as HTMLButtonElement;
    restartBtn.addEventListener("click", () => {
      this.resetState();
      this.renderStart();
    });
  }

  private async playFullScene(): Promise<void> {
    const script = this.script;
    if (!script) return;
    this.playbackAbort = false;
    for (const line of script.lines) {
      if (this.playbackAbort) return;
      const isMine = line.speaker === this.myCharacter;
      const myRecording = isMine ? this.recordedAudio.get(line.id) : undefined;

      if (myRecording) {
        this.setStatus(`Now playing: ${line.speaker} (your performance)`);
        const videoRange =
          line.start_seconds !== undefined && line.start_seconds !== null
            ? { start: line.start_seconds, end: line.end_seconds ?? null }
            : undefined;
        await this.playRecordedBlob(myRecording, 1, videoRange);
      } else {
        this.setStatus(
          `Now playing: ${line.speaker}${isMine ? " (your line has no recording; the original audio is lowered)" : ""}`,
        );
        await this.playReferenceForLine(line, isMine ? DUCK_VOLUME : 1);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    if (!this.playbackAbort) this.setStatus("Scene finished.");
  }
}
