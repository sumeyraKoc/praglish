import Phaser from "phaser";
import { DubApiClient, DubApiError, DubScript, DubScriptLine, WordVerdict } from "../services/DubApiClient";

/**
 * "Sahneyi Seslendir" (Dub the Scene) - TEK KISILIK Listen & Repeat modu.
 *
 * Bu sahne bilincli olarak RoomScene/LibraryScene'den BAGIMSIZ: kendi
 * DOM panelini kurar, normal oyun akisina (harita/NPC/kelime) hic
 * dokunmaz. Mimari kararlar icin bkz. api/routes/dub.py dosya basi
 * aciklamasi.
 *
 * NOT: bu ozellik ONCE cok oyunculu (oda kur/katil, WebSocket, ngrok ile
 * farkli aglardan katilim) olarak yapilmisti; proje kararlastirdi ki su an
 * icin TEK KISILIK ilerlesin - coklu oyuncu ileride ayrica eklenecek.
 * Akis simdi soyle:
 *   1) Oyuncu bir sahne (script) ve seslendirmek istedigi TEK bir karakter
 *      secer.
 *   2) Sahne bastan sona, repliklerin sirasina gore ilerler: secilmeyen
 *      karakterin repliklerinde orijinal ses (klip varsa klipten, yoksa
 *      TTS ile) oldugu gibi/tam ses seviyesinde calinir; secilen
 *      karakterin repliklerinde "dinle -> tekrar et -> kaydet -> puanla"
 *      akisi calisir.
 *   3) Sahne bitince oyuncu kendi repliklerinin puanlarini gorur ve
 *      isterse tum sahneyi bastan dinleyebilir - bu tekrar dinlemede
 *      SADECE kendi sectigi karakterin sesi kisilir (bkz. playFullScene),
 *      digerleri tam ses seviyesinde kalir.
 */

type Screen = "start" | "your-turn" | "other-turn" | "finished";

interface SummaryEntry {
  line: DubScriptLine;
  words: WordVerdict[];
  accuracy_percent: number;
}

const RECORDING_AUTO_STOP_MS = 12_000;
// "Tum Sahneyi Dinle"de sadece kullanicinin sectigi karakterin sesini
// kismak icin (bkz. dosya basi aciklama, madde 3) - tamamen susturmuyoruz
// (0), boylece sahne "kesintisiz" hissi vermeye devam ediyor ama oyuncu
// kendi repliginin nerede oldugunu net duyuyor.
const DUCK_VOLUME = 0.12;

export class DubScene extends Phaser.Scene {
  private readonly api = new DubApiClient();

  private panel: Phaser.GameObjects.DOMElement | null = null;
  private statusEl: HTMLElement | null = null;
  private screen: Screen = "start";

  private availableScripts: DubScript[] = [];
  private levelsEl: HTMLElement | null = null;
  private expandedScriptId: string | null = null;

  private script: DubScript | null = null;
  private myCharacter = "";
  private lineIndex = 0;
  private summary: SummaryEntry[] = [];

  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private recordAutoStopHandle: number | null = null;

  private currentAudio: HTMLAudioElement | null = null;
  private playbackAbort = false;

  private turnBodyEl: HTMLElement | null = null;
  private turnRecordBtn: HTMLButtonElement | null = null;

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
      // Backend zaten zorluk puanina gore siralayip level numarasi atiyor
      // (bkz. dub.py _compute_difficulty_score) - burada sadece savunma
      // amacli tekrar sirala (level alani beklenmedik sekilde gelirse).
      this.availableScripts = [...scripts].sort((a, b) => a.level - b.level);
      if (this.screen !== "start") return; // kullanici cok hizli ilerlediyse bu ekran artik yok
      this.renderLevelMap();
    } catch {
      this.availableScripts = [];
      if (this.screen === "start") {
        this.setStatus("Sahneler yuklenemedi. Sunucu calisiyor mu? Sayfayi yenileyip tekrar dene.", true);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Ilerleme kaydi (localStorage) - henuz hesap/login sistemi olmadigi
  // icin (proje karari: "en son islemimiz" login/signup) ilerleme
  // TARAYICIDA, cihaza ozel tutulur. Script degistirmeden/karakter
  // degistirmeden once bkz. dosya basi not: coklu oyuncu/hesap sistemi
  // eklendiginde bu localStorage katmani sunucu tarafli bir progress
  // tablosuyla (bkz. api/models/models.py VocabularyProgress ornegi) 1:1
  // degistirilebilecek sekilde kasitli olarak kucuk ve izole tutuldu.
  // ---------------------------------------------------------------------

  private static readonly COMPLETION_KEY = "praglish.dub.completion.v1";
  private static readonly LAST_CHARACTER_KEY = "praglish.dub.lastCharacter.v1";

  /**
   * Replik replik dogruluk yuzdesi zaten OYUN SIRASINDA (bkz.
   * renderLineFeedback) aninda gosteriliyor - ayrica saklamaya gerek yok.
   * Burada sadece bir karakterin TAMAMLANMIS bir turunun ORTALAMA
   * dogrulugu tutulur (bkz. renderFinished) - seviye haritasindaki
   * user-ikonlari kac REPLIK degil, kac KARAKTER oldugunu gosterir; bir
   * karakter en az bir kez tamamlanmissa o ikon yesile doner ve altta o
   * karakterin toplam yuzdesi yazar.
   */
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
      // localStorage yoksa/dolu ise ilerleme kaydedilemez ama oyun akisi bozulmaz.
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
      // yoksay - sadece "varsayilan secili karakter" hatirlanamaz
    }
  }

  // ---------------------------------------------------------------------
  // Ekran 1: seviye (level) haritasi - script listesi artik acilir kutu
  // degil, zorluk puanina gore siralanmis numarali "seviye" dugmeleri
  // olarak gosteriliyor (bkz. dub.py). Her dugmenin altinda, sahnede kac
  // KARAKTER varsa o kadar user-ikonu var (orn. Charade'de 2: Reggie,
  // Bartholomew) - bir karakteri en az bir kez bastan sona tamamlamissa o
  // ikon yesile doner; en altta en son secilen karakterin adi ve o
  // karakterle alinan toplam (ortalama) dogruluk yuzdesi yaziyor.
  // ---------------------------------------------------------------------

  private renderLevelMap(): void {
    if (!this.levelsEl) return;
    if (this.availableScripts.length === 0) {
      this.levelsEl.innerHTML = `<p class="dialogue-status">Henuz eklenmis bir sahne yok.</p>`;
      return;
    }

    this.levelsEl.innerHTML = this.availableScripts
      .map((script, index) => this.renderLevelItemHtml(script, index))
      .join("");

    this.levelsEl.querySelectorAll("[data-action='toggle-level']").forEach((el) => {
      el.addEventListener("click", () => {
        const scriptId = (el as HTMLElement).dataset["script"];
        if (!scriptId) return;
        this.expandedScriptId = this.expandedScriptId === scriptId ? null : scriptId;
        this.renderLevelMap();
      });
    });

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
    const lastCharacter = this.getLastCharacter(script.id, script.characters[0] ?? "");

    const iconsHtml = script.characters
      .map((character) => {
        const done = this.getCharacterCompletion(script.id, character) !== null;
        return `
          <svg class="dub-user-icon ${done ? "done" : ""}" viewBox="0 0 24 24" width="20" height="20">
            <title>${this.escapeHtml(character)}</title>
            <circle cx="12" cy="8" r="5"></circle>
            <path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8"></path>
          </svg>
        `;
      })
      .join("");

    const lastCompletion = this.getCharacterCompletion(script.id, lastCharacter);
    const percentLabel = lastCompletion !== null
      ? `${this.escapeHtml(lastCharacter)} - %${lastCompletion}`
      : "Henuz oynanmadi";

    const charsHtml = script.characters
      .map(
        (c) =>
          `<button type="button" class="dub-char-btn" data-action="pick-character" data-script="${this.escapeHtml(script.id)}" data-character="${this.escapeHtml(c)}">${this.escapeHtml(c)}</button>`,
      )
      .join("");

    const isExpanded = this.expandedScriptId === script.id;

    return `
      <div class="dub-level-item">
        ${index > 0 ? '<div class="dub-level-connector"></div>' : ""}
        <button type="button" class="dub-level-node ${isExpanded ? "active" : ""}" data-action="toggle-level" data-script="${this.escapeHtml(script.id)}">
          <span class="dub-level-num">${script.level}</span>
        </button>
        <div class="dub-level-title">${this.escapeHtml(script.title)}</div>
        <div class="dub-level-icons">${iconsHtml || '<span class="dub-level-percent">-</span>'}</div>
        <div class="dub-level-percent">${percentLabel}</div>
        <div class="dub-level-chars" data-role="chars" ${isExpanded ? "" : "hidden"}>${charsHtml}</div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Genel yardimcilar
  // ---------------------------------------------------------------------

  private teardown(): void {
    this.playbackAbort = true;
    this.stopCurrentAudio();
    this.clearRecordAutoStop();
    if (this.isRecording) this.mediaRecorder?.stop();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.panel?.destroy();
    this.panel = null;
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

  private mount(html: string): HTMLElement {
    this.panel?.destroy();
    const dom = this.add.dom(640, 360).createFromHTML(html);
    this.panel = dom;
    const node = dom.node as HTMLElement;
    this.statusEl = node.querySelector('[data-role="status"]');
    const closeBtn = node.querySelector('[data-action="exit"]');
    closeBtn?.addEventListener("click", () => this.exitToMenu());
    return node;
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
  }

  // ---------------------------------------------------------------------
  // Ekran 1: baslangic (sahne + karakter secimi)
  // ---------------------------------------------------------------------

  private renderStart(): void {
    this.screen = "start";
    this.expandedScriptId = null;
    const node = this.mount(`
      <div class="dialogue-panel dub-panel dub-panel--levels">
        <div class="dialogue-header">
          <strong>Sahneyi Seslendir</strong>
          <span>Listen &amp; Repeat</span>
          <button type="button" class="dialogue-close" data-action="exit" aria-label="Close">x</button>
        </div>
        <div class="dialogue-status" data-role="status">Bir seviye sec, ardindan seslendirmek istedigin karakteri belirle.</div>
        <div class="dub-body">
          <div class="dub-levels" data-role="levels"><p class="dialogue-status">Yukleniyor...</p></div>
        </div>
      </div>
    `);

    this.levelsEl = node.querySelector('[data-role="levels"]') as HTMLElement;
    if (this.availableScripts.length > 0) this.renderLevelMap();
  }

  private startScene(script: DubScript, character: string): void {
    this.script = script;
    this.myCharacter = character;
    this.lineIndex = 0;
    this.summary = [];
    this.advanceLine();
  }

  // ---------------------------------------------------------------------
  // Sahne ilerleme - her replikte kimin sirasi oldugunu kontrol eder
  // ---------------------------------------------------------------------

  private advanceLine(): void {
    if (!this.script) return;
    if (this.lineIndex >= this.script.lines.length) {
      this.renderFinished();
      return;
    }
    const line = this.script.lines[this.lineIndex];
    if (!line) {
      // lineIndex kontrolu yukarida yapildi, buraya normalde hic dusmez -
      // TypeScript'in noUncheckedIndexedAccess kurali icin savunma amacli.
      this.renderFinished();
      return;
    }
    if (line.speaker === this.myCharacter) {
      this.renderYourTurn(line);
    } else {
      this.renderOtherTurn(line);
    }
  }

  /**
   * Bir replik icin referans sesi calar: script gercek bir klibe
   * dayaniyorsa (bkz. DubScript.audio_url) o klibin [start, end) araligini,
   * yoksa TTS ile o an sentezlenmis sesi. `volume` sadece "Tum Sahneyi
   * Dinle" (playFullScene) adiminda 1'den farkli olur.
   */
  private playReferenceForLine(line: DubScriptLine, volume: number): Promise<void> {
    if (this.script?.audio_url && line.start_seconds !== undefined && line.start_seconds !== null) {
      return this.playAudioSegment(this.script.audio_url, line.start_seconds, line.end_seconds ?? null, volume);
    }
    return this.playLine(line.text, line.voice, volume);
  }

  // ---------------------------------------------------------------------
  // Ekran 2a: sira sende (dinle -> tekrar et -> kaydet -> puanla)
  // ---------------------------------------------------------------------

  private renderYourTurn(line: DubScriptLine): void {
    this.screen = "your-turn";
    const total = this.script!.lines.length;
    const node = this.mount(`
      <div class="dialogue-panel dub-panel">
        <div class="dialogue-header">
          <strong>Sira sende! (${this.escapeHtml(this.myCharacter)})</strong>
          <span>Replik ${this.lineIndex + 1}/${total}</span>
          <button type="button" class="dialogue-close" data-action="exit" aria-label="Close">x</button>
        </div>
        <div class="dialogue-status" data-role="status">Repligi dinliyorsun...</div>
        <div class="dub-body dub-col" data-role="turn-body">
          <div class="dub-row">
            <button type="button" class="dub-btn secondary" data-action="replay">Tekrar Dinle</button>
            <button type="button" class="dub-btn dub-rec-btn" data-action="record" disabled>Kayda Basla</button>
          </div>
        </div>
      </div>
    `);

    const replayBtn = node.querySelector('[data-action="replay"]') as HTMLButtonElement;
    const recordBtn = node.querySelector('[data-action="record"]') as HTMLButtonElement;
    this.turnBodyEl = node.querySelector('[data-role="turn-body"]') as HTMLElement;
    this.turnRecordBtn = recordBtn;

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

    void playReference().then(() => {
      recordBtn.disabled = false;
      this.setStatus("Simdi sirayla tekrar et - kaydi baslat.");
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
      this.setStatus("Ses hazirlanamadi - yine de tekrar edebilirsin.");
    }
  }

  /**
   * Gercek bir ses klibinden (game/public/assets/dub/... - Vite tarafindan
   * servis edilir, orn. Charade (1963)'ten cikarilmis SADECE SES dosyasi)
   * [start, end) araligini oynatir. Sunucu klibi hicbir sekilde
   * kesmiyor/donusturmuyor (ffmpeg yok) - sadece tarayicida oynatma
   * pozisyonu/ses seviyesi kontrol ediliyor (bkz. dub.py dosya basi mimari
   * notu).
   */
  private async playAudioSegment(url: string, start: number, end: number | null, volume = 1): Promise<void> {
    this.stopCurrentAudio();
    const audio = new Audio(url);
    audio.volume = volume;
    this.currentAudio = audio;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        audio.removeEventListener("timeupdate", onTimeUpdate);
        audio.removeEventListener("ended", finish);
        audio.removeEventListener("error", finish);
        audio.pause();
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
      this.setStatus("Bu tarayicida mikrofon destegi yok.");
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
      this.setStatus("Kayittasin... bitirince tekrar butona bas.");
      if (this.turnRecordBtn) this.turnRecordBtn.textContent = "Kaydi Bitir";
      this.recordAutoStopHandle = window.setTimeout(() => this.finishRecording(), RECORDING_AUTO_STOP_MS);
    } catch {
      this.setStatus("Mikrofon izni verilmedi.");
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
  }

  private async submitRecording(): Promise<void> {
    const script = this.script;
    if (!script) return;
    const line = script.lines[this.lineIndex];
    if (!line) return; // guvenlik amacli - normalde bu index her zaman gecerli
    const recordedType = this.mediaRecorder?.mimeType || "audio/webm";
    const blob = new Blob(this.audioChunks, { type: recordedType });
    this.audioChunks = [];
    if (blob.size === 0) {
      this.setStatus("Ses kaydedilemedi - tekrar dene.");
      return;
    }
    this.setStatus("Degerlendiriliyor...");
    try {
      const result = await this.api.scoreLine(script.id, line.id, blob);
      this.renderLineFeedback(line, result.words, result.accuracy_percent);
    } catch (error: unknown) {
      this.setStatus(this.describeError(error, "Degerlendirme basarisiz oldu."));
    }
  }

  private renderLineFeedback(line: DubScriptLine, words: WordVerdict[], accuracy: number): void {
    const body = this.turnBodyEl;
    if (!body) return;
    const wordsHtml = words
      .map((w) => `<span class="dub-word ${w.correct ? "correct" : "wrong"}">${this.escapeHtml(w.word)}</span>`)
      .join("");
    body.innerHTML = `
      <div>${wordsHtml}</div>
      <div class="dub-turn-indicator">Dogruluk: %${accuracy}</div>
      <button type="button" class="dub-btn" data-action="continue">Devam Et</button>
    `;
    const continueBtn = body.querySelector('[data-action="continue"]') as HTMLButtonElement;
    continueBtn.addEventListener("click", () => {
      continueBtn.disabled = true;
      this.summary.push({ line, words, accuracy_percent: accuracy });
      this.lineIndex += 1;
      this.advanceLine();
    });
    this.setStatus("Tamamlandi.");
  }

  // ---------------------------------------------------------------------
  // Ekran 2b: sira baskasinda - orijinal ses tam seviyede calar
  // ---------------------------------------------------------------------

  private renderOtherTurn(line: DubScriptLine): void {
    this.screen = "other-turn";
    const total = this.script!.lines.length;
    const node = this.mount(`
      <div class="dialogue-panel dub-panel">
        <div class="dialogue-header">
          <strong>${this.escapeHtml(line.speaker)} konusuyor</strong>
          <span>Replik ${this.lineIndex + 1}/${total}</span>
          <button type="button" class="dialogue-close" data-action="exit" aria-label="Close">x</button>
        </div>
        <div class="dialogue-status" data-role="status">Dinliyorsun...</div>
        <div class="dub-body dub-col">
          <div class="dub-turn-indicator">"${this.escapeHtml(line.text)}"</div>
          <div class="dub-row">
            <button type="button" class="dub-btn secondary" data-action="replay">Tekrar Dinle</button>
            <button type="button" class="dub-btn" data-action="continue" disabled>Devam Et</button>
          </div>
        </div>
      </div>
    `);

    const replayBtn = node.querySelector('[data-action="replay"]') as HTMLButtonElement;
    const continueBtn = node.querySelector('[data-action="continue"]') as HTMLButtonElement;

    const playReference = (): Promise<void> => this.playReferenceForLine(line, 1);

    replayBtn.addEventListener("click", () => {
      void playReference();
    });
    continueBtn.addEventListener("click", () => {
      this.lineIndex += 1;
      this.advanceLine();
    });

    void playReference().then(() => {
      continueBtn.disabled = false;
      this.setStatus("Devam etmek icin butona bas.");
    });
  }

  // ---------------------------------------------------------------------
  // Ekran 3: bitis - kendi repliklerinin puanlari + tum sahneyi dinle
  // ---------------------------------------------------------------------

  private renderFinished(): void {
    this.screen = "finished";
    this.playbackAbort = true;

    // Sahne (bu karakter icin) bastan sona tamamlandi - seviye haritasindaki
    // ilgili user-ikonunu yesile cevirmek ve altinda gosterilecek toplam
    // yuzdeyi hesaplamak icin ortalama dogrulugu kaydet (bkz. dosya basi not:
    // replik replik detay degil, sadece karakter+ortalama saklaniyor).
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
          <strong>Sahne tamamlandi!</strong>
          <span>${this.escapeHtml(this.myCharacter)} olarak nasil gitti?</span>
          <button type="button" class="dialogue-close" data-action="exit" aria-label="Close">x</button>
        </div>
        <div class="dialogue-status" data-role="status">Kendi repliklerini asagida gorebilir ya da tum sahneyi dinleyebilirsin.</div>
        <div class="dub-body" data-role="summary-list">${linesHtml || "<p>Kayitli replik yok.</p>"}</div>
        <div class="dub-row" style="margin-top:10px;">
          <button type="button" class="dub-btn" data-action="play-all">Tum Sahneyi Dinle</button>
          <button type="button" class="dub-btn secondary" data-action="restart">Yeniden Basla</button>
        </div>
      </div>
    `);

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

  /**
   * Tum sahneyi bastan sona, repliklerin sirasina gore tek tek calar.
   * SADECE oyuncunun sectigi karakterin repliklerinde ses DUCK_VOLUME'a
   * kisilir (tamamen susmuyor) - digerleri tam ses seviyesinde kalir.
   */
  private async playFullScene(): Promise<void> {
    const script = this.script;
    if (!script) return;
    this.playbackAbort = false;
    for (const line of script.lines) {
      if (this.playbackAbort) return;
      const isMine = line.speaker === this.myCharacter;
      this.setStatus(`Simdi calan: ${line.speaker}${isMine ? " (senin replik - sesi kisildi)" : ""}`);
      await this.playReferenceForLine(line, isMine ? DUCK_VOLUME : 1);
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    if (!this.playbackAbort) this.setStatus("Sahne bitti.");
  }
}
