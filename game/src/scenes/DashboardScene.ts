import Phaser from "phaser";
import { DashboardData, PraglishApiClient } from "../services/PraglishApiClient";


type DashboardPage = "overview" | "grammar" | "vocabulary" | "idioms";

interface DashboardLaunchData {
  returnScene?: string;
}

export class DashboardScene extends Phaser.Scene {
  private readonly api = new PraglishApiClient();
  private panel: Phaser.GameObjects.DOMElement | null = null;
  private dashboard: DashboardData | null = null;
  private currentPage: DashboardPage = "overview";
  private returnScene = "LibraryScene";

  constructor() {
    super("DashboardScene");
  }

  public init(data: DashboardLaunchData): void {
    this.returnScene = data.returnScene ?? "LibraryScene";
  }

  public create(): void {
    this.cameras.main.setBackgroundColor("#0d1428");
    this.renderShell();
    this.input.keyboard?.on("keydown-ESC", () => this.exitDashboard());
    this.input.keyboard?.on("keydown-P", () => this.exitDashboard());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.panel?.destroy();
      this.panel = null;
    });
    void this.loadDashboard();
  }

  private async loadDashboard(): Promise<void> {
    try {
      this.dashboard = await this.api.getDashboard();
      this.renderPage();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Dashboard could not be loaded.";
      const content = this.panel?.node.querySelector("[data-dashboard-content]");
      if (content) {
        content.innerHTML = `<div class="paper-empty">${this.escapeHtml(message)}</div>`;
      }
    }
  }

  private renderShell(): void {
    this.panel = this.add.dom(640, 360).createFromHTML(`
      <section class="progress-dashboard" aria-label="Learning progress dashboard">
        <header class="progress-header">
          <div><strong>PRAGLISH JOURNAL</strong><span>MY LEARNING ADVENTURE</span></div>
          <button type="button" class="paper-close" data-action="close">P / ESC · CLOSE</button>
        </header>
        <nav class="paper-tabs" aria-label="Dashboard pages">
          <button type="button" data-page="overview">PROFILE</button>
          <button type="button" data-page="grammar">GRAMMAR</button>
          <button type="button" data-page="vocabulary">WORDS</button>
          <button type="button" data-page="idioms">IDIOMS</button>
        </nav>
        <div class="paper-book" data-dashboard-content>
          <div class="paper-empty">Defter aciliyor...</div>
        </div>
      </section>
    `);
    const node = this.panel.node as HTMLElement;
    node.querySelector('[data-action="close"]')?.addEventListener("click", () => this.exitDashboard());
    node.querySelector(".paper-tabs")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("[data-page]") as HTMLElement | null;
      const page = button?.dataset["page"] as DashboardPage | undefined;
      if (!page) return;
      this.currentPage = page;
      this.renderPage();
    });
  }

  private renderPage(): void {
    const content = this.panel?.node.querySelector("[data-dashboard-content]") as HTMLElement | null;
    const data = this.dashboard;
    if (!content || !data) return;

    this.panel?.node.querySelectorAll("[data-page]").forEach((tab) => {
      tab.classList.toggle("active", (tab as HTMLElement).dataset["page"] === this.currentPage);
    });

    if (this.currentPage === "grammar") content.innerHTML = this.renderGrammar(data);
    else if (this.currentPage === "vocabulary") content.innerHTML = this.renderVocabulary(data);
    else if (this.currentPage === "idioms") content.innerHTML = this.renderIdioms(data);
    else content.innerHTML = this.renderOverview(data);
  }

  private renderOverview(data: DashboardData): string {
    const maxDaily = Math.max(1, ...data.weekly_activity.map((day) => day.correct + day.incorrect));
    const bars = data.weekly_activity.map((day) => {
      const correctHeight = Math.round(day.correct / maxDaily * 90);
      const incorrectHeight = Math.round(day.incorrect / maxDaily * 90);
      return `<div class="week-column" title="${day.date}: ${day.correct} correct, ${day.incorrect} incorrect">
        <div class="week-bars"><i class="correct" style="height:${correctHeight}px"></i><i class="incorrect" style="height:${incorrectHeight}px"></i></div>
        <small>${this.escapeHtml(day.date.slice(5))}</small>
      </div>`;
    }).join("");
    const locations = data.locations.length
      ? data.locations.map((item) => `<li><span>${this.escapeHtml(item.name)}</span><b>${item.turn_count}</b></li>`).join("")
      : '<li class="muted">No room activity has been recorded yet.</li>';

    return this.bookPages(
      "PROFILE",
      `<div class="pixel-avatar">🙂</div>
       <h2>${this.escapeHtml(this.displayName(data.profile.username))}</h2>
       <div class="level-ribbon">LEVEL ${data.profile.level}</div>
       ${this.statGrid([
         ["XP", data.profile.xp], ["COINS", data.profile.coins],
         ["WORDS", data.summary.words_learned], ["IDIOMS", data.summary.idioms_discovered],
       ])}`,
      "7 DAY JOURNEY",
      `<div class="success-score"><strong>%${data.summary.success_percent}</strong><span>SUCCESS</span></div>
       <div class="week-chart">${bars}</div>
       <ul class="location-list">${locations}</ul>`,
    );
  }

  private renderGrammar(data: DashboardData): string {
    const topics = [...data.grammar_topics].sort((a, b) => a.topic_id - b.topic_id);
    return this.bookPages(
      "SPELL BOOK 01-25",
      this.grammarCards(topics.slice(0, 25)),
      "SPELL BOOK 26-50",
      this.grammarCards(topics.slice(25, 50)),
    );
  }

  private renderVocabulary(data: DashboardData): string {
    const maxLevel = Math.max(1, ...data.vocabulary_levels.map((item) => item.count));
    const levels = data.vocabulary_levels.map((item) => `
      <div class="paper-meter"><span>${this.escapeHtml(item.name)}</span><i><b style="width:${Math.round(item.count / maxLevel * 100)}%"></b></i><strong>${item.count}</strong></div>
    `).join("");
    const maxError = Math.max(1, ...data.vocabulary_errors.map((item) => item.count));
    const errors = data.vocabulary_errors.map((item) => `
      <div class="paper-meter error"><span>${this.escapeHtml(this.prettyLabel(item.name))}</span><i><b style="width:${Math.round(item.count / maxError * 100)}%"></b></i><strong>${item.count}</strong></div>
    `).join("");
    return this.bookPages("WORD LEVELS", levels, "MONSTERS TO BEAT", errors);
  }

  private renderIdioms(data: DashboardData): string {
    const discovered = data.idioms.filter((idiom) => idiom.correct_count > 0);
    const practice = data.idioms.filter((idiom) => idiom.incorrect_count > 0);
    return this.bookPages(
      "BADGE COLLECTION",
      this.idiomCards(discovered, "No idioms have been used correctly yet."),
      "TRAINING LIST",
      this.idiomCards(practice, "No idiom mistakes have been found yet."),
    );
  }

  private bookPages(leftTitle: string, left: string, rightTitle: string, right: string): string {
    return `<section class="paper-page left"><h1>${leftTitle}</h1><div class="paper-scroll">${left}</div></section>
      <div class="book-spine"></div>
      <section class="paper-page right"><h1>${rightTitle}</h1><div class="paper-scroll">${right}</div></section>`;
  }

  private statGrid(items: [string, number][]): string {
    return `<div class="paper-stat-grid">${items.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>`;
  }

  private grammarCards(items: DashboardData["grammar_topics"]): string {
    return `<div class="grammar-grid">${items.map((topic) => {
      const total = topic.correct_count + topic.incorrect_count;
      const tone = topic.incorrect_count > 0 ? "bad" : total > 0 ? "good" : "unseen";
      const score = total > 0
        ? `✓ ${topic.correct_count} · ✕ ${topic.incorrect_count}`
        : "NOT SEEN YET";
      return `<article class="grammar-card ${tone}">
      <b>#${topic.topic_id} ${this.escapeHtml(topic.topic_name)}</b>
      <span>${score}</span><i style="width:${topic.mastery_percent}%"></i>
    </article>`;
    }).join("")}</div>`;
  }

  private idiomCards(items: DashboardData["idioms"], empty: string): string {
    if (items.length === 0) return `<div class="paper-empty">${empty}</div>`;
    return items.map((idiom) => `<article class="idiom-card"><span>◆</span><div><b>${this.escapeHtml(idiom.display_idiom)}</b><small>✓ ${idiom.correct_count} · ✕ ${idiom.incorrect_count}</small></div></article>`).join("");
  }

  private displayName(username: string): string {
    return username.startsWith("guest_") ? `PLAYER ${username.slice(-4).toUpperCase()}` : username;
  }

  private prettyLabel(value: string): string {
    return value.replace(/_/g, " ").toUpperCase();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private exitDashboard(): void {
    this.scene.start(this.returnScene);
  }
}
