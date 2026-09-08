import Phaser from "phaser";

/** Dublaj akisini normal NPC odalarindan ayiran giris odasi. */
export class StudioScene extends Phaser.Scene {
  constructor() {
    super("StudioScene");
  }

  public create(): void {
    this.cameras.main.setBackgroundColor("#15111f");

    const graphics = this.add.graphics();
    graphics.fillStyle(0x241a33, 1).fillRect(120, 95, 1040, 535);
    graphics.fillStyle(0x39284d, 1).fillRect(145, 120, 990, 465);
    graphics.fillStyle(0x171020, 1).fillRect(205, 165, 870, 330);
    graphics.lineStyle(4, 0x78dce8, 0.8).strokeRect(205, 165, 870, 330);

    // Kayit studyosu hissi veren basit, assetsiz sahne elemanlari.
    graphics.fillStyle(0x5d4c72, 1).fillRect(625, 240, 30, 125);
    graphics.fillStyle(0x78dce8, 1).fillRoundedRect(600, 195, 80, 75, 24);
    graphics.lineStyle(8, 0x78dce8, 1);
    graphics.beginPath().arc(640, 265, 75, 0, Math.PI, false).strokePath();
    graphics.lineBetween(640, 340, 640, 405);
    graphics.lineBetween(590, 405, 690, 405);

    this.add.text(24, 22, "PRAGLISH · DUBBING STUDIO", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "22px",
      color: "#78dce8",
    }).setDepth(10);

    this.add.text(24, 54, "L: Library · B: Bakery · P: Progress · M: Menu", {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      color: "#d8cfeb",
    }).setDepth(10);

    this.add.text(640, 455, "Bir sahne sec, karakterini al ve replikleri tekrar et.", {
      fontFamily: "Arial, sans-serif",
      fontSize: "17px",
      color: "#d8cfeb",
      align: "center",
    }).setOrigin(0.5);

    const launcher = this.add.dom(640, 545).createFromHTML(
      '<button type="button" class="dub-launcher">🎬 Sahneyi Seslendir</button>',
    );
    const button = launcher.node.querySelector("button") as HTMLButtonElement;
    button.addEventListener("click", () => this.scene.start("DubScene"));

    this.input.keyboard?.on("keydown-L", () => this.scene.start("LibraryScene"));
    this.input.keyboard?.on("keydown-B", () => this.scene.start("RoomScene"));
    this.input.keyboard?.on("keydown-M", () => this.scene.start("MenuScene"));
    this.input.keyboard?.on("keydown-P", () => {
      this.scene.start("DashboardScene", { returnScene: "StudioScene" });
    });
  }
}
