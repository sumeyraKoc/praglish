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
 *      sectigi karakterin repliklerinde ORIJINAL ses yerine oyuncunun
 *      KENDI KAYDI calinir (gercek "dublaj"; bkz. recordedAudio/
 *      playFullScene) - bir replik icin kayit yoksa DUCK_VOLUME'a kisilmis
 *      orijinal sese geri dusulur. Digerleri tam ses seviyesinde kalir.
 */

type Screen = "start" | "your-turn" | "other-turn" | "finished";

interface SummaryEntry {
  line: DubScriptLine;
  words: WordVerdict[];
  accuracy_percent: number;
}

const RECORDING_AUTO_STOP_MS = 12_000;
// "Tum Sahneyi Dinle"de normalde oyuncunun KENDI KAYDI calinir (bkz.
// recordedAudio/playFullScene, dosya basi aciklama madde 3) - bu sadece o
// repligin kaydi hicbir sebeple mevcut degilse devreye giren YEDEK
// davranistir: orijinal ses tamamen susturulmaz (0), boylece sahne
// "kesintisiz" hissi vermeye devam ediyor ama oyuncu kendi repliginin
// nerede oldugunu net duyuyor.
const DUCK_VOLUME = 0.12;

// ---------------------------------------------------------------------
// Ekran 1 (script secimi) gorsel varliklari - "ahsap masa" arka plani ve
// uzerine serpistirilmis "not kagidi" yigin gorselleri (bkz.
// game/public/assets/dub/ui/). Her script bir not kagidina atanir; script
// sayisi not gorseli sayisini (4) asarsa NOTE_IMAGES dongusel (modulo)
// olarak tekrar kullanilir, boylece yeni bir script eklendiginde kod
// degismeden calismaya devam eder.
const SCRIPT_SELECT_BG_URL = "/assets/dub/ui/script-select-bg.jpg";
const NOTE_IMAGES = [
  "/assets/dub/ui/note1.png",
  "/assets/dub/ui/note2.png",
  "/assets/dub/ui/note3.png",
  "/assets/dub/ui/note4.png",
];
// Mevcut 4 script icin not gorselinin kosesindeki cizime (bos / buyutec /
// orumcek agi / roket) gore ELDE tema eslesmesi yapildi (orn. Superman ->
// roketli not) - listede olmayan (gelecekte eklenecek) script'ler icin
// index'e gore NOTE_IMAGES dongusune dusulur (bkz. noteImageForScript).
const SCRIPT_NOTE_OVERRIDES: Record<string, string> = {
  "charade-44": NOTE_IMAGES[1], // buyutec - casusluk/gerilim sahnesi
  "superman-caverns": NOTE_IMAGES[3], // roket - bilim-kurgu/superkahraman
  "notld-cemetery": NOTE_IMAGES[2], // orumcek agi - korku sahnesi
  "gulliver-wedding": NOTE_IMAGES[0], // duz kagit - masalsi macera
};
function noteImageForScript(scriptId: string, index: number): string {
  return SCRIPT_NOTE_OVERRIDES[scriptId] ?? NOTE_IMAGES[index % NOTE_IMAGES.length];
}
// Karakter isim dugmelerine (referans gorseldeki renkli "player" pillerinin
// yerini alan, GERCEK karakter adlarini tasiyan dugmeler) dongusel renk
// atamak icin kucuk bir palet - hangi karakterin "onemli" oldugunu degil,
// sadece gorsel cesitliligi ifade eder.
const CHARACTER_PILL_COLORS = ["#6bbf6b", "#e0668f", "#e8a23c", "#8f7ae0", "#4fb8c9"];
function characterPillColor(index: number): string {
  return CHARACTER_PILL_COLORS[index % CHARACTER_PILL_COLORS.length];
}

export class DubScene extends Phaser.Scene {
  private readonly api = new DubApiClient();

  private panel: Phaser.GameObjects.DOMElement | null = null;
  private statusEl: HTMLElement | null = null;
  private screen: Screen = "start";

  private availableScripts: DubScript[] = [];
  private levelsEl: HTMLElement | null = null;
  // renderStart() birden fazla kez cagrilabildigi icin (bkz. create() ve
  // "sahne bitince basa don" akisi) "?" yardim balonunun disina tiklayinca
  // kapatan document-level listener HER SEFERINDE eskisi kaldirilip yeniden
  // eklenir - aksi halde her donuste bir tane daha birikir (leak).
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
  // Oyuncunun kaydettigi her repligin sesi (bkz. submitRecording) - "Tum
  // Sahneyi Dinle" (playFullScene) sirasinda kendi karakterinin repliklerinde
  // orijinal ses yerine BUNU calmak icin bellekte tutulur (sadece bu sahne
  // suresince - sekmeyi kapatinca/sahneden cikinca kaybolur, kalici degil).
  private recordedAudio = new Map<number, Blob>();

  private currentAudio: HTMLAudioElement | null = null;
  private playbackAbort = false;
  // Script'in video_url'i varsa (bkz. DubScript.video_url) o anki ekranda
  // (sira-sende/diger-sira/bitis) render edilen <video muted> elementine
  // referans - karakterin AGIZ HAREKETLERINI gormek icin, ses HER ZAMAN
  // ayri calinir (bkz. playAudioSegment/playRecordedBlob). Ekran degistikce
  // mount() yeni bir DOM olusturdugu icin bu referans da yenilenir.
  private videoEl: HTMLVideoElement | null = null;

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
  // Ekran 1: script secimi - "ahsap masa" arka plani uzerinde, her script
  // icin bir "not kagidi yigini" karti (bkz. dosya basi NOTE_IMAGES/
  // SCRIPT_NOTE_OVERRIDES). Referans tasarimdaki gibi karakter dugmeleri
  // HER ZAMAN gorunur (eskisi gibi once numarali dugmeye tiklayip acmaya
  // gerek yok) ve dugmelerde "Player N" degil o script'in GERCEK karakter
  // isimleri yaziyor. Kartin altinda, sahnede kac KARAKTER varsa o kadar
  // user-ikonu var; bir karakteri en az bir kez bastan sona tamamlamissa o
  // ikon yesile doner, en altta en son secilen karakterin adi ve o
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
    // NOT: kartta artik tamamlanma ikonlari/yuzdesi GOSTERILMIYOR (kullanici
    // istegi - sade "afis" gorunumu). Altyapi (getCharacterCompletion,
    // getLastCharacter, recordCharacterCompletion) kasitli olarak
    // SILINMEDI: bu veri hala renderFinished'da yaziliyor ve ileride bir
    // istatistik/ilerleme ekraninda tekrar kullanilabilir.
    const charsHtml = script.characters
      .map(
        (c, charIndex) =>
          `<button type="button" class="dub-char-pill" style="--pill-color:${characterPillColor(charIndex)}" data-action="pick-character" data-script="${this.escapeHtml(script.id)}" data-character="${this.escapeHtml(c)}">${this.escapeHtml(c)}</button>`,
      )
      .join("");

    const noteUrl = noteImageForScript(script.id, index);
    // ONEMLI: buyuk harfe cevirmeyi CSS'in text-transform:uppercase'ine
    // BIRAKMIYORUZ - sayfa <html lang="tr"> oldugu icin tarayici "i" harfini
    // Turkce kurallarina gore noktali "I" (İ) yapiyor ("Gulliver's" ->
    // "GULLİVER'S", "Night"/"Living" -> "NİGHT"/"LİVİNG" gibi bozuk
    // gorunumlere yol aciyordu). JS'in duz .toUpperCase()'i (locale
    // belirtilmeden) bu ozel Turkce kurali UYGULAMAZ, bu yuzden metni
    // BURADA buyutup CSS'te text-transform KULLANMIYORUZ. Once buyut,
    // SONRA escape et - tersi olsaydi (once escape) ileride baslikta "&"
    // gibi bir karakter cikarsa "&amp;" -> "&AMP;" olup bozulurdu.
    const displayTitle = this.escapeHtml(script.title.toUpperCase());

    return `
      <div class="dub-note-card" style="background-image:url('${noteUrl}')">
        <div class="dub-note-title">${displayTitle}</div>
        <div class="dub-note-chars">${charsHtml}</div>
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
    if (this.helpOutsideClickHandler) {
      document.removeEventListener("click", this.helpOutsideClickHandler);
      this.helpOutsideClickHandler = null;
    }
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

  /**
   * Verilen node icindeki `[data-role="<dataRole>"]` <video> elementini
   * bulur, script'in video_url'i varsa src'sini ayarlayip this.videoEl'e
   * atar (yoksa gizler/null birakir). Her ekran mount() ile YENIDEN DOM
   * kurdugu icin bu her renderYourTurn/renderOtherTurn/renderFinished
   * cagrisinda tekrar cagrilir.
   */
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

  /**
   * this.videoEl'i [start, end) araligina gore oynatir - karakterin agiz
   * hareketlerini SESSIZ olarak gostermek icin (gercek ses ayri calinir,
   * bkz. playAudioSegment/playRecordedBlob). end null ise video kendi
   * dogal akisinda devam eder (disaridan stopVideoElement ile durdurulmali).
   */
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
        /* video sessiz oldugu icin autoplay engeli beklenmez, yine de sessizce yut */
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
  // Ekran 1: baslangic (sahne + karakter secimi)
  // ---------------------------------------------------------------------

  private renderStart(): void {
    this.screen = "start";
    // NOT: bu ekranin basligi artik klasik .dialogue-header (kalin yazi +
    // "x" kapat) degil - kullanicinin referans aldigi ahsap "SELECT A
    // SCRIPT"/"BACK" afisleri gibi UC AYRI eleman: solda ahsap "BACK"
    // dugmesi (data-action="exit" ayni - mount() bunu genel olarak
    // dinliyor), ortada dekoratif ahsap "LISTEN & REPEAT" afisi, sagda
    // uzerine gelince/dokununca aciklama balonu acan "?" yardim ikonu -
    // eski aciklama metni artik hep-gorunur degil, bu balonun icinde.
    // [data-role="status"] YINE DE panelde duruyor (bos baslar) - cunku
    // loadScripts() basarisiz olursa setStatus() ile hata mesaji BURAYA
    // yazilir (bkz. loadScripts).
    const node = this.mount(`
      <div class="dialogue-panel dub-panel dub-panel--levels">
        <div class="dub-levels-header">
          <button type="button" class="dub-wood-btn dub-wood-btn--back" data-action="exit" aria-label="Geri don">Back</button>
          <div class="dub-wood-banner">Listen &amp; Repeat</div>
          <div class="dub-help" data-role="help">
            <button type="button" class="dub-help-icon" data-action="toggle-help" aria-label="Yardim">?</button>
            <div class="dub-help-tooltip" role="tooltip">
              <strong>Sahneyi Seslendir</strong>
              Bir seviye sec, ardindan seslendirmek istedigin karakteri belirle.
            </div>
          </div>
        </div>
        <div class="dialogue-status dub-levels-status" data-role="status"></div>
        <div class="dub-body dub-levels-body">
          <div class="dub-levels" data-role="levels"><p class="dialogue-status">Yukleniyor...</p></div>
        </div>
      </div>
    `);

    const helpEl = node.querySelector('[data-role="help"]') as HTMLElement | null;
    const helpToggle = node.querySelector('[data-action="toggle-help"]');
    helpToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      helpEl?.classList.toggle("open");
    });
    // Dokunmatik/mobil: yardim balonunun disina dokununca kapat (hover'i
    // olmayan cihazlarda "?" tekrar basilana kadar acik kalmasin diye).
    // Eski listener'i (varsa) kaldirmadan yenisini eklemek renderStart()
    // her cagrildiginda bir tane daha biriktirir - once temizle.
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
        <video class="dub-video" data-role="line-video" muted playsinline></video>
        <div class="dub-body dub-col" data-role="turn-body">
          <div class="dub-row">
            <button type="button" class="dub-btn secondary" data-action="replay">Tekrar Dinle</button>
            <button type="button" class="dub-btn dub-rec-btn" data-action="record" disabled>Kayda Basla</button>
          </div>
        </div>
      </div>
    `);

    this.setupVideoElement(node, "line-video");

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
   * Oyuncunun daha once kaydettigi (bkz. submitRecording -> recordedAudio)
   * bir repligin sesini calar - "Tum Sahneyi Dinle"de kendi karakterinin
   * repliklerinde ORIJINAL ses yerine bu kullanilir (bkz. playFullScene).
   * `videoRange` verilirse (o repligin start/end saniyeleri), ses oyuncunun
   * KENDI KAYDI olsa bile karakterin ORIJINAL (sessiz) video goruntusu ayni
   * aralikta paralel oynatilir - yani "dublaj" hissi: goruntu orijinal
   * oyuncudan, ses senden. Kayit suresi video araligindan farkli olabilir
   * (kullanicinin soyleme hizi), bu durumda video kendi araliginin sonunda
   * durur, ses (varsa) bagimsiz devam eder - kucuk bir senkron kaybi kabul
   * edilebilir, onemli olan gorsel baglam.
   */
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
    // Ses klibiyle AYNI kaynaktan, AYNI zaman cizelgesiyle kirpilmis SESSIZ
    // video varsa (bkz. DubScript.video_url), karakterin agiz hareketlerini
    // gormek icin sesle PARALEL, ayni [start, end) araliginda oynatilir.
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
    // "Tum Sahneyi Dinle"de bu repligi ORIJINAL ses yerine bununla degistirmek
    // icin sakla (bkz. playFullScene) - puanlama basarisiz olsa bile kayit
    // yine de burada kalir, kullanici en azindan kendi seslendirmesini dinleyebilir.
    this.recordedAudio.set(line.id, blob);
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
        <video class="dub-video" data-role="line-video" muted playsinline></video>
        <div class="dub-body dub-col">
          <div class="dub-turn-indicator">"${this.escapeHtml(line.text)}"</div>
          <div class="dub-row">
            <button type="button" class="dub-btn secondary" data-action="replay">Tekrar Dinle</button>
            <button type="button" class="dub-btn" data-action="continue" disabled>Devam Et</button>
          </div>
        </div>
      </div>
    `);

    this.setupVideoElement(node, "line-video");

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
        <video class="dub-video" data-role="line-video" muted playsinline></video>
        <div class="dub-body" data-role="summary-list">${linesHtml || "<p>Kayitli replik yok.</p>"}</div>
        <div class="dub-row" style="margin-top:10px;">
          <button type="button" class="dub-btn" data-action="play-all">Tum Sahneyi Dinle</button>
          <button type="button" class="dub-btn secondary" data-action="restart">Yeniden Basla</button>
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

  /**
   * Tum sahneyi bastan sona, repliklerin sirasina gore tek tek calar.
   * Oyuncunun sectigi karakterin repliklerinde ORIJINAL ses yerine
   * oyuncunun KENDI KAYDI calinir (bkz. recordedAudio/submitRecording) -
   * yani sahnedeki o karakterin sesi gercekten oyuncununkiyle "dublajlanmis"
   * olur. Bir replik icin herhangi bir sebeple kayit yoksa (orn. o repligi
   * hic denemeden sahneyi bitirdiyse) DUCK_VOLUME'a kisilmis orijinal sese
   * geri dusulur - digerleri (secilmeyen karakter) tam ses seviyesinde kalir.
   */
  private async playFullScene(): Promise<void> {
    const script = this.script;
    if (!script) return;
    this.playbackAbort = false;
    for (const line of script.lines) {
      if (this.playbackAbort) return;
      const isMine = line.speaker === this.myCharacter;
      const myRecording = isMine ? this.recordedAudio.get(line.id) : undefined;

      if (myRecording) {
        this.setStatus(`Simdi calan: ${line.speaker} (senin seslendirmen)`);
        const videoRange =
          line.start_seconds !== undefined && line.start_seconds !== null
            ? { start: line.start_seconds, end: line.end_seconds ?? null }
            : undefined;
        await this.playRecordedBlob(myRecording, 1, videoRange);
      } else {
        this.setStatus(
          `Simdi calan: ${line.speaker}${isMine ? " (senin replik - kaydin yok, orijinal ses kisildi)" : ""}`,
        );
        await this.playReferenceForLine(line, isMine ? DUCK_VOLUME : 1);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    if (!this.playbackAbort) this.setStatus("Sahne bitti.");
  }
}
