import Phaser from "phaser";
import { DubApiClient, DubApiError, DubScript, DubServerMessage, WordVerdict } from "../services/DubApiClient";

/**
 * "Sahneyi Seslendir" (Dub the Scene) - cok oyunculu Listen & Repeat modu.
 *
 * Bu sahne bilincli olarak RoomScene/LibraryScene'den BAGIMSIZ: kendi
 * DOM panelini kurar, kendi WebSocket baglantisini yonetir, ve normal
 * oyun akisina (harita/NPC/kelime) hic dokunmaz. Mimari ve gizlilik
 * kararlari icin bkz. api/routes/dub.py dosya basi aciklamasi - ayni
 * kurallar burada da gecerli:
 *   - Sunucuda veritabani/kalici depolama yok, oda bellekte.
 *   - Sirasi olmayan oyuncuya repligin METNI VE SESI HICBIR ZAMAN
 *     gonderilmiyor (bkz. handleTurn) - "herkese yolla, frontend'te
 *     gizle" degil, sunucu zaten gondermiyor.
 *   - Gercek video/dizi klibi yok (istisna: dogrulanmis kamu mali bir
 *     ses klibine dayanan scriptler - bkz. dub.py DubScript.audio_url).
 *
 * Bir odaya KOD ILE katilan oyuncu, hangi karakterlerin var oldugunu ve
 * hangilerinin zaten dolu oldugunu /api/dub/rooms/{code} (GET) ile o
 * spesifik odadan ogrenir - bkz. handleJoinRoom. (Eskiden bu bilgi
 * /api/dub/scripts listesinin ilk elemanindan TAHMIN EDILIYORDU, birden
 * fazla script eklenince - orn. host "Charade" ile oda actiginda -
 * katilan oyuncuya yanlislikla "sample-cafe"nin A/B karakterleri
 * gosteriliyordu; bu artik dogru script'ten okunuyor.)
 */

type Screen = "start" | "character-pick" | "lobby" | "turn" | "finished";

interface LobbyPlayer {
  name: string;
  character: string;
}

interface FinishedSummaryLine {
  line_id: number;
  speaker: string;
  player_name: string;
  expected: string;
  transcript: string;
  accuracy_percent: number;
  words: WordVerdict[];
}

const RECORDING_AUTO_STOP_MS = 12_000;

export class DubScene extends Phaser.Scene {
  private readonly api = new DubApiClient();

  private panel: Phaser.GameObjects.DOMElement | null = null;
  private statusEl: HTMLElement | null = null;
  private screen: Screen = "start";

  private ws: WebSocket | null = null;
  private hasJoined = false;

  private roomCode = "";
  private playerName = "";
  private playerToken = "";
  private pendingCharacter = "";
  private myCharacter = "";
  private isHost = false;

  private characters: string[] = [];
  private hostName = "";
  private players: LobbyPlayer[] = [];

  private currentLineId: number | null = null;
  private currentLineSpeaker = "";
  private currentLineIndex = 0;
  private currentTotalLines = 0;

  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private recordAutoStopHandle: number | null = null;

  private currentAudio: HTMLAudioElement | null = null;
  private playbackAbort = false;

  private availableScripts: DubScript[] = [];
  private scriptSelectEl: HTMLSelectElement | null = null;

  private turnBodyEl: HTMLElement | null = null;
  private turnRecordBtn: HTMLButtonElement | null = null;

  constructor() {
    super("DubScene");
  }

  public create(): void {
    this.hasJoined = false;
    this.screen = "start";
    this.renderStart();
    void this.loadScripts();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  private async loadScripts(): Promise<void> {
    try {
      this.availableScripts = await this.api.listScripts();
    } catch {
      this.availableScripts = []; // secim kutusu "At the Cafe (sample)" varsayilanina duser
    }
    this.populateScriptSelect();
  }

  private populateScriptSelect(): void {
    if (!this.scriptSelectEl) return;
    if (this.availableScripts.length === 0) {
      this.scriptSelectEl.innerHTML = '<option value="sample-cafe">At the Cafe (sample)</option>';
      return;
    }
    this.scriptSelectEl.innerHTML = this.availableScripts
      .map((s) => `<option value="${this.escapeHtml(s.id)}">${this.escapeHtml(s.title)}</option>`)
      .join("");
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
    this.ws?.close();
    this.ws = null;
    this.panel?.destroy();
    this.panel = null;
  }

  private exitToStudio(): void {
    this.teardown();
    this.scene.start("StudioScene");
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
    closeBtn?.addEventListener("click", () => this.exitToStudio());
    return node;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------
  // Ekran 1: baslangic (oda kur / odaya katil)
  // ---------------------------------------------------------------------

  private renderStart(): void {
    this.screen = "start";
    const node = this.mount(`
      <div class="dialogue-panel dub-panel">
        <div class="dialogue-header">
          <strong>Sahneyi Seslendir</strong>
          <span>Listen &amp; Repeat - coklu oyuncu</span>
          <button type="button" class="dialogue-close" data-action="exit" aria-label="Close">x</button>
        </div>
        <div class="dialogue-status" data-role="status">Bir isim gir ve oda kur ya da bir koda katil.</div>
        <div class="dub-body dub-col">
          <input class="dub-input" data-role="name" type="text" placeholder="Adin" maxlength="24" />
          <div class="dub-row">
            <select class="dub-input" data-role="script"><option value="sample-cafe">Yükleniyor...</option></select>
          </div>
          <div class="dub-row">
            <button type="button" class="dub-btn" data-action="create">Oda Kur</button>
          </div>
          <div class="dub-row">
            <input class="dub-input" data-role="join-code" type="text" placeholder="Oda kodu" maxlength="4" style="width:110px; text-transform:uppercase;" />
            <button type="button" class="dub-btn secondary" data-action="join">Odaya Katil</button>
          </div>
        </div>
      </div>
    `);

    const nameInput = node.querySelector('[data-role="name"]') as HTMLInputElement;
    const joinCodeInput = node.querySelector('[data-role="join-code"]') as HTMLInputElement;
    const createBtn = node.querySelector('[data-action="create"]') as HTMLButtonElement;
    const joinBtn = node.querySelector('[data-action="join"]') as HTMLButtonElement;
    this.scriptSelectEl = node.querySelector('[data-role="script"]') as HTMLSelectElement;
    this.populateScriptSelect();

    createBtn.addEventListener("click", () => {
      const scriptId = this.scriptSelectEl?.value || "sample-cafe";
      void this.handleCreateRoom(nameInput.value, scriptId);
    });
    joinBtn.addEventListener("click", () => {
      void this.handleJoinRoom(nameInput.value, joinCodeInput.value);
    });
  }

  private async handleCreateRoom(rawName: string, scriptId: string): Promise<void> {
    const name = rawName.trim();
    if (!name) {
      this.setStatus("Once adini yaz.");
      return;
    }
    this.setStatus("Oda kuruluyor...");
    try {
      const response = await this.api.createRoom(name, scriptId);
      this.playerName = name;
      this.roomCode = response.room_code;
      this.playerToken = response.player_token;
      this.isHost = true;
      this.characters = response.script.characters;
      this.hostName = name;
      this.renderCharacterPick();
    } catch (error: unknown) {
      this.setStatus(this.describeError(error, "Oda kurulamadi."));
    }
  }

  private async handleJoinRoom(rawName: string, rawCode: string): Promise<void> {
    const name = rawName.trim();
    const code = rawCode.trim().toUpperCase();
    if (!name) {
      this.setStatus("Once adini yaz.");
      return;
    }
    if (code.length !== 4) {
      this.setStatus("Oda kodu 4 karakter olmali.");
      return;
    }
    this.setStatus("Oda bilgisi aliniyor...");
    try {
      const info = await this.api.getRoomInfo(code);
      if (info.state !== "lobby") {
        this.setStatus("Bu oda artik oyuncu kabul etmiyor.", true);
        return;
      }
      this.playerName = name;
      this.roomCode = code;
      this.playerToken = "";
      this.isHost = false;
      this.characters = info.characters;
      this.hostName = info.host_name;
      this.renderCharacterPick(info.taken_characters);
    } catch (error: unknown) {
      this.setStatus(this.describeError(error, "Oda bulunamadi. Kodu kontrol et."), true);
    }
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof DubApiError) return error.message;
    if (error instanceof Error) return error.message;
    return fallback;
  }

  // ---------------------------------------------------------------------
  // Ekran 2: karakter secimi (secince WebSocket join gonderilir)
  // ---------------------------------------------------------------------

  private renderCharacterPick(takenCharacters: string[] = []): void {
    this.screen = "character-pick";
    const charButtons = this.characters
      .map((character) => {
        const isTaken = takenCharacters.includes(character);
        const cls = isTaken ? "dub-char-btn taken" : "dub-char-btn";
        const disabled = isTaken ? "disabled" : "";
        const label = isTaken ? `${character} (dolu)` : character;
        return `<button type="button" class="${cls}" data-character="${this.escapeHtml(character)}" ${disabled}>${this.escapeHtml(label)}</button>`;
      })
      .join("");

    const node = this.mount(`
      <div class="dialogue-panel dub-panel">
        <div class="dialogue-header">
          <strong>Oda: ${this.escapeHtml(this.roomCode)}</strong>
          <span>${this.isHost ? "Oda kodunu arkadaslarinla paylas" : "Bir karakter sec"}</span>
          <button type="button" class="dialogue-close" data-action="exit" aria-label="Close">x</button>
        </div>
        <div class="dialogue-status" data-role="status">Seslendirmek istedigin karakteri sec.</div>
        <div class="dub-body">
          <div class="dub-char-list" data-role="char-list">${charButtons}</div>
          <div class="dub-row" style="margin-top:14px;">
            <button type="button" class="dub-btn secondary" data-action="back">Geri</button>
          </div>
        </div>
      </div>
    `);

    const backBtn = node.querySelector('[data-action="back"]') as HTMLButtonElement;
    backBtn.addEventListener("click", () => {
      this.ws?.close();
      this.ws = null;
      this.renderStart();
    });

    const charList = node.querySelector('[data-role="char-list"]') as HTMLElement;
    charList.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest("[data-character]") as HTMLElement | null;
      if (!target) return;
      const character = target.dataset["character"];
      if (!character) return;
      this.chooseCharacter(character);
    });
  }

  private chooseCharacter(character: string): void {
    this.pendingCharacter = character;
    this.setStatus(`'${character}' olarak katiliniyor...`);
    this.ensureSocket(() => this.sendJoin(character));
  }

  private ensureSocket(onOpen: () => void): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      onOpen();
      return;
    }
    if (this.ws) {
      this.ws.close();
    }
    const ws = this.api.connectRoom(this.roomCode);
    this.ws = ws;
    ws.addEventListener("open", () => onOpen());
    ws.addEventListener("message", (event) => this.handleServerMessage(event));
    ws.addEventListener("close", (event) => this.handleSocketClose(event));
    ws.addEventListener("error", () => {
      if (!this.hasJoined) this.setStatus("Baglanti kurulamadi. Oda kodunu kontrol et.");
    });
  }

  private sendJoin(character: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: "join",
      name: this.playerName,
      character,
      ...(this.playerToken ? { player_token: this.playerToken } : {}),
    }));
  }

  private handleSocketClose(event: CloseEvent): void {
    if (this.hasJoined) return; // oyun bittikten/oda kapandiktan sonraki normal kapanma
    if (event.code === 4404) {
      this.setStatus("Oda bulunamadi. Kodu kontrol edip tekrar dene.");
    } else if (this.screen === "character-pick") {
      this.setStatus("Baglanti koptu. Tekrar dene.");
    }
  }

  // ---------------------------------------------------------------------
  // Sunucudan gelen mesajlar
  // ---------------------------------------------------------------------

  private handleServerMessage(event: MessageEvent<string>): void {
    let message: DubServerMessage;
    try {
      message = JSON.parse(event.data) as DubServerMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case "joined": {
        this.playerToken = message.player_token;
        break;
      }
      case "room_state": {
        this.hostName = message.host_name;
        if (this.characters.length === 0) this.characters = message.characters;
        this.players = message.players;
        if (!this.hasJoined) {
          this.hasJoined = true;
          this.myCharacter = this.pendingCharacter;
        }
        if (this.screen !== "turn" && this.screen !== "finished") this.renderLobby();
        break;
      }
      case "turn": {
        this.currentLineId = message.line_id;
        this.currentLineSpeaker = message.speaker;
        this.currentLineIndex = message.line_index;
        this.currentTotalLines = message.total_lines;
        if (message.for_you && message.text !== undefined) {
          const voice = message.voice ?? "Kore";
          this.renderTurnForYou(message.text, voice, message.audio_url, message.start_seconds, message.end_seconds);
        } else {
          this.renderTurnForOther();
        }
        break;
      }
      case "finished": {
        this.renderFinished(message.summary);
        break;
      }
      case "error": {
        // Backend hata metinleri Ingilizce (bkz. dub.py) - en sik karsilasilan
        // "Baslat"a basinca-tum-karakterler-dolmamis durumunu kullaniciya
        // daha anlasilir gostermek icin burada ceviriyoruz, digerlerini
        // oldugu gibi gosteriyoruz.
        const unassignedPrefix = "unassigned characters: ";
        const text = message.detail.startsWith(unassignedPrefix)
          ? `Once herkes bir karakter secmeli (bos: ${message.detail.slice(unassignedPrefix.length)}).`
          : message.detail;
        this.setStatus(text, true);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Ekran 3: lobi (oyuncular + baslat)
  // ---------------------------------------------------------------------

  private renderLobby(): void {
    this.screen = "lobby";
    const playerRows = this.players
      .map((p) => `<li>${this.escapeHtml(p.character)}: ${this.escapeHtml(p.name)}${p.name === this.hostName ? " (host)" : ""}</li>`)
      .join("");
    const canStart = this.isHost;

    const node = this.mount(`
      <div class="dialogue-panel dub-panel">
        <div class="dialogue-header">
          <strong>Oda: ${this.escapeHtml(this.roomCode)}</strong>
          <span>Sen: ${this.escapeHtml(this.myCharacter)}</span>
          <button type="button" class="dialogue-close" data-action="exit" aria-label="Close">x</button>
        </div>
        <div class="dialogue-status" data-role="status">${canStart ? "Herkes hazir olunca baslat." : "Host baslatmasini bekliyorsun..."}</div>
        <div class="dub-body dub-col">
          <ul class="dub-player-list">${playerRows}</ul>
          ${canStart ? '<button type="button" class="dub-btn" data-action="start">Baslat</button>' : ""}
        </div>
      </div>
    `);

    const startBtn = node.querySelector('[data-action="start"]') as HTMLButtonElement | null;
    startBtn?.addEventListener("click", () => {
      this.ws?.send(JSON.stringify({ type: "start" }));
    });
  }

  // ---------------------------------------------------------------------
  // Ekran 4a: sira sende (dinle -> tekrar et -> puanla)
  // ---------------------------------------------------------------------

  private renderTurnForYou(
    text: string,
    voice: string,
    audioUrl?: string,
    startSeconds?: number,
    endSeconds?: number | null,
  ): void {
    this.screen = "turn";
    const node = this.mount(`
      <div class="dialogue-panel dub-panel">
        <div class="dialogue-header">
          <strong>Sira sende! (${this.escapeHtml(this.currentLineSpeaker)})</strong>
          <span>Replik ${this.currentLineIndex + 1}/${this.currentTotalLines}</span>
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

    // Script gercek bir ses klibine dayaniyorsa (bkz. dub.py
    // DubScript.audio_url) TTS yerine o klibin ilgili saniye araligini
    // calariz - orijinal aktorun sesini duyup onu tekrar etmek, sentezlenmis
    // bir sesten daha gercekci bir "Listen & Repeat" deneyimi verir.
    const playSegment = (): Promise<void> => {
      if (audioUrl !== undefined && startSeconds !== undefined) {
        return this.playAudioSegment(audioUrl, startSeconds, endSeconds ?? null);
      }
      return this.playLine(text, voice);
    };

    replayBtn.addEventListener("click", () => {
      void playSegment();
    });
    recordBtn.addEventListener("click", () => {
      if (this.isRecording) {
        this.finishRecording();
      } else {
        void this.startRecording();
      }
    });

    void playSegment().then(() => {
      recordBtn.disabled = false;
      this.setStatus("Simdi sirayla tekrar et - kaydi baslat.");
    });
  }

  private async playLine(text: string, voice: string): Promise<void> {
    this.stopCurrentAudio();
    try {
      const blob = await this.api.synthesizeLine(text, voice);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
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
   * [start, end) araligini oynatir. "Sunucuda video/ses render/birlestirme
   * yok" ilkesi burada da gecerli: klip donusturulmuyor/kesilmiyor, sadece
   * tarayicida oynatma pozisyonu kontrol ediliyor (bkz. dub.py dosya basi
   * mimari notu) - playLine()'daki TTS akisiyla ayni <audio> mekanizmasi,
   * tek fark baslangic noktasini secip bitince durdurmasi.
   */
  private async playAudioSegment(url: string, start: number, end: number | null): Promise<void> {
    this.stopCurrentAudio();
    const audio = new Audio(url);
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
    const lineId = this.currentLineId;
    if (lineId === null) return;
    const recordedType = this.mediaRecorder?.mimeType || "audio/webm";
    const blob = new Blob(this.audioChunks, { type: recordedType });
    this.audioChunks = [];
    if (blob.size === 0) {
      this.setStatus("Ses kaydedilemedi - tekrar dene.");
      return;
    }
    this.setStatus("Degerlendiriliyor...");
    try {
      const result = await this.api.scoreLine(this.roomCode, lineId, this.playerToken, blob);
      this.renderLineFeedback(result.words, result.accuracy_percent);
    } catch (error: unknown) {
      this.setStatus(this.describeError(error, "Degerlendirme basarisiz oldu."));
    }
  }

  private renderLineFeedback(words: WordVerdict[], accuracy: number): void {
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
      this.ws?.send(JSON.stringify({ type: "line_done", line_id: this.currentLineId }));
      this.setStatus("Sonraki replik bekleniyor...");
      continueBtn.disabled = true;
    });
    this.setStatus("Tamamlandi.");
  }

  // ---------------------------------------------------------------------
  // Ekran 4b: sira baskasinda (bekleme - metin/ses HIC gonderilmez)
  // ---------------------------------------------------------------------

  private renderTurnForOther(): void {
    this.screen = "turn";
    const speakerPlayer = this.players.find((p) => p.character === this.currentLineSpeaker);
    const who = speakerPlayer ? `${speakerPlayer.name} (${this.currentLineSpeaker})` : this.currentLineSpeaker;

    this.mount(`
      <div class="dialogue-panel dub-panel">
        <div class="dialogue-header">
          <strong>Sahne devam ediyor</strong>
          <span>Replik ${this.currentLineIndex + 1}/${this.currentTotalLines}</span>
          <button type="button" class="dialogue-close" data-action="exit" aria-label="Close">x</button>
        </div>
        <div class="dialogue-status" data-role="status">${this.escapeHtml(who)} konusuyor...</div>
        <div class="dub-body">
          <div class="dub-turn-indicator">🎭 Sira sende degil - bekle.</div>
        </div>
      </div>
    `);
  }

  // ---------------------------------------------------------------------
  // Ekran 5: bitis - sahneyi izle (renkli altyazi + herkesin sesi)
  // ---------------------------------------------------------------------

  private renderFinished(summary: FinishedSummaryLine[]): void {
    this.screen = "finished";
    this.playbackAbort = true;

    const linesHtml = summary
      .map((line) => {
        const wordsHtml = line.words
          .map((w) => `<span class="dub-word ${w.correct ? "correct" : "wrong"}">${this.escapeHtml(w.word)}</span>`)
          .join("");
        return `
          <div class="dub-summary-line" data-line-id="${line.line_id}">
            <strong>${this.escapeHtml(line.speaker)}</strong> (${this.escapeHtml(line.player_name)}) - %${line.accuracy_percent}
            <button type="button" class="dub-btn secondary" data-play-line="${line.line_id}" style="float:right; min-width:auto; padding:4px 10px; height:auto;">▶</button>
            <div>${wordsHtml}</div>
          </div>
        `;
      })
      .join("");

    const node = this.mount(`
      <div class="dialogue-panel dub-panel">
        <div class="dialogue-header">
          <strong>Sahne tamamlandi!</strong>
          <span>Kim ne dogru soyledi?</span>
          <button type="button" class="dialogue-close" data-action="exit" aria-label="Close">x</button>
        </div>
        <div class="dialogue-status" data-role="status">Tek tek dinleyebilir ya da tum sahneyi izleyebilirsin.</div>
        <div class="dub-body" data-role="summary-list">${linesHtml}</div>
        <div class="dub-row" style="margin-top:10px;">
          <button type="button" class="dub-btn" data-action="play-all">Tum Sahneyi Izle</button>
          <button type="button" class="dub-btn secondary" data-action="new-room">Yeni Oda</button>
        </div>
      </div>
    `);

    const list = node.querySelector('[data-role="summary-list"]') as HTMLElement;
    list.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest("[data-play-line]") as HTMLElement | null;
      if (!target) return;
      const lineId = Number(target.dataset["playLine"]);
      if (!Number.isFinite(lineId)) return;
      this.playRecordedLine(lineId);
    });

    const playAllBtn = node.querySelector('[data-action="play-all"]') as HTMLButtonElement;
    playAllBtn.addEventListener("click", () => {
      void this.playFullScene(summary);
    });

    const newRoomBtn = node.querySelector('[data-action="new-room"]') as HTMLButtonElement;
    newRoomBtn.addEventListener("click", () => {
      this.ws?.send(JSON.stringify({ type: "leave" }));
      this.ws?.close();
      this.ws = null;
      this.hasJoined = false;
      this.resetRoomState();
      this.renderStart();
    });
  }

  private resetRoomState(): void {
    this.roomCode = "";
    this.playerName = "";
    this.playerToken = "";
    this.pendingCharacter = "";
    this.myCharacter = "";
    this.isHost = false;
    this.characters = [];
    this.hostName = "";
    this.players = [];
    this.currentLineId = null;
    this.currentLineSpeaker = "";
  }

  private playRecordedLine(lineId: number): boolean {
    this.stopCurrentAudio();
    const url = this.api.lineAudioUrl(this.roomCode, lineId);
    const audio = new Audio(url);
    this.currentAudio = audio;
    audio.play().catch(() => undefined);
    return true;
  }

  private async playFullScene(summary: FinishedSummaryLine[]): Promise<void> {
    this.playbackAbort = false;
    for (const line of summary) {
      if (this.playbackAbort) return;
      this.setStatus(`Simdi calan: ${line.speaker} (${line.player_name})`);
      await this.playAndWait(this.api.lineAudioUrl(this.roomCode, line.line_id));
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    if (!this.playbackAbort) this.setStatus("Sahne bitti.");
  }

  private async playAndWait(url: string): Promise<void> {
    this.stopCurrentAudio();
    const audio = new Audio(url);
    this.currentAudio = audio;
    await new Promise<void>((resolve) => {
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener("error", () => resolve(), { once: true });
      audio.play().catch(() => resolve());
    });
  }
}
