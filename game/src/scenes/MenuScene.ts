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

const MODE_CARDS: ModeCard[] = [
  {
    id: "roleplay",
    accent: "#ffd166",
    spineLabel: "ROLEPLAY",
    title: "Roleplay",
    description:
      "Talk to NPCs in places such as the library and bakery, complete dialogue goals, and earn new words.",
    targetScene: "LibraryScene",
    artHtml: '<div class="menu-card-art menu-art-roleplay"></div>',
  },
  {
    id: "dub",
    accent: "#78dce8",
    spineLabel: "LISTEN &amp; REPEAT",
    title: "Dub the Scene",
    description:
      "Choose a scene and character, perform your lines, then watch the full scene with your own voice.",
    targetScene: "DubScene",
    artHtml: MIC_ICON_HTML,
  },
];

export class MenuScene extends Phaser.Scene {
  private root: HTMLElement | null = null;
  private expandedId: string | null = null;

  constructor() {
    super("MenuScene");
  }

  public create(): void {
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
              <button type="button" class="menu-play-btn" data-action="play" data-target="${card.targetScene}">Play</button>
            </div>
          </div>
        </div>
      `,
    ).join("");

    return `
      <div class="menu-root">
        <div class="menu-heading">
          <strong>PRAGLISH</strong>
          <span>Choose a mode</span>
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
