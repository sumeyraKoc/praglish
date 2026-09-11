import Phaser from "phaser";
import { PraglishApiClient } from "../services/PraglishApiClient";
import { clearRememberedDialogues } from "../services/RoleplayMemory";

interface ModeCard {
  id: string;
  accent: string;
  spineLabel: string;
  title: string;
  description: string;
  targetScene: string;
  artHtml: string;
}

const MIC_ICON_HTML = `
  <div class="menu-card-art">
    <svg class="menu-mic-icon" viewBox="0 0 200 200" width="130" height="130">
      <rect x="78" y="30" width="44" height="70" rx="22" fill="#78dce8"></rect>
      <path d="M 55 90 A 45 45 0 0 0 145 90" fill="none" stroke="#78dce8" stroke-width="10" stroke-linecap="round"></path>
      <line x1="100" y1="135" x2="100" y2="165" stroke="#78dce8" stroke-width="10" stroke-linecap="round"></line>
      <line x1="65" y1="165" x2="135" y2="165" stroke="#78dce8" stroke-width="10" stroke-linecap="round"></line>
    </svg>
  </div>
`;

// Yeni bir mod eklendiginde tek yapilmasi gereken: buraya bir ModeCard daha
// eklemek (gorsel icin ya mevcut asset'lerden bir collage - .menu-art-* -
// ya da MIC_ICON_HTML gibi kucuk bir SVG). Aksordiyon, kart sayisi kadar
// otomatik genisler.
const MODE_CARDS: ModeCard[] = [
  {
    id: "roleplay",
    accent: "#ffd166",
    spineLabel: "ROLEPLAY",
    title: "Roleplay",
    description:
      "Kutuphane ve firin gibi mekanlarda NPC'lerle konus, replik ver ve yeni kelimeler kazan.",
    targetScene: "LibraryScene",
    artHtml: '<div class="menu-card-art menu-art-roleplay"></div>',
  },
  {
    id: "dub",
    accent: "#78dce8",
    spineLabel: "LISTEN &amp; REPEAT",
    title: "Sahneyi Seslendir",
    description:
      "Bir sahne ve karakter sec, repliklerini tekrar et; sahne sonunda tum sahneyi kendi seslendirmenle dinle.",
    targetScene: "DubScene",
    artHtml: MIC_ICON_HTML,
  },
];

/**
 * Ana menu / mod secim ekrani. Login-signup akisi henuz yok, oyun su an
 * dogrudan bu menuden basliyor (bkz. main.ts sahne sirasi).
 *
 * Kapali (varsayilan) durumda her mod, hafifce ust uste binen dikey bir
 * "sirt" (spine) olarak durur. Uzerine gelince kart hafifce kalkar/egilir;
 * tiklaninca yatayda genisleyip gorseli, aciklamayi ve "Oyna" butonunu
 * gosterir, digerleri kucularak kenara cekilir. Ayni karta tekrar tiklamak
 * ya da baska bir karta tiklamak durumu degistirir.
 */
export class MenuScene extends Phaser.Scene {
  private root: HTMLElement | null = null;
  private expandedId: string | null = null;

  constructor() {
    super("MenuScene");
  }

  public create(): void {
    // Menu yeni bir roleplay ziyareti icin sinirdir. Oda gecisleri bu noktaya
    // ugramadigi icin Maya ve Lina kendi ayri sohbetlerini hatirlamaya devam eder.
    PraglishApiClient.resetAllSessions();
    clearRememberedDialogues();

    this.cameras.main.setBackgroundColor("#15111f");

    const graphics = this.add.graphics();
    graphics.fillStyle(0x241a33, 1).fillRect(70, 60, 1140, 620);
    graphics.fillStyle(0x171020, 1).fillRect(100, 90, 1080, 560);
    graphics.lineStyle(3, 0x5d4c72, 0.7).strokeRect(100, 90, 1080, 560);

    const dom = this.add.dom(640, 380).createFromHTML(this.renderHtml());
    this.root = dom.node as HTMLElement;
    this.wireEvents();
  }

  private renderHtml(): string {
    const cardsHtml = MODE_CARDS.map(
      (card) => `
        <div class="menu-card" data-mode="${card.id}" style="--accent:${card.accent};">
          <div class="menu-card-spine">
            <span class="menu-card-spine-label">${card.spineLabel}</span>
          </div>
          <div class="menu-card-face">
            ${card.artHtml}
            <div class="menu-card-info">
              <h3>${card.title}</h3>
              <p>${card.description}</p>
              <button type="button" class="menu-play-btn" data-action="play" data-target="${card.targetScene}">Oyna</button>
            </div>
          </div>
        </div>
      `,
    ).join("");

    return `
      <div class="menu-root">
        <div class="menu-heading">
          <strong>PRAGLISH</strong>
          <span>Bir mod sec</span>
        </div>
        <div class="menu-accordion" data-role="accordion">${cardsHtml}</div>
      </div>
    `;
  }

  private wireEvents(): void {
    if (!this.root) return;
    const accordion = this.root.querySelector('[data-role="accordion"]');
    if (!accordion) return;

    accordion.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;

      const playBtn = target.closest('[data-action="play"]') as HTMLElement | null;
      if (playBtn) {
        const targetScene = playBtn.dataset["target"];
        if (targetScene) this.scene.start(targetScene);
        return;
      }

      const card = target.closest(".menu-card") as HTMLElement | null;
      if (!card) return;
      const mode = card.dataset["mode"];
      if (!mode) return;
      this.setExpanded(mode);
    });
  }

  private setExpanded(mode: string): void {
    if (!this.root) return;
    this.expandedId = this.expandedId === mode ? null : mode;
    const cards = this.root.querySelectorAll<HTMLElement>(".menu-card");
    cards.forEach((card) => {
      const isExpanded = card.dataset["mode"] === this.expandedId;
      card.classList.toggle("expanded", isExpanded);
      card.classList.toggle("dimmed", this.expandedId !== null && !isExpanded);
    });
  }
}
