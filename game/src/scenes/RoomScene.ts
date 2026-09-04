import Phaser from "phaser";
import { calculateDepth } from "../engine/DepthSort";
import { gridToScreen, IsoConfig, screenToGrid } from "../engine/IsometricMath";
import { findPath, PathfindingGrid } from "../engine/PathFinder";
import { IsoAvatar } from "../entities/IsoAvatar";
import { PraglishApiClient, TurnResponse } from "../services/PraglishApiClient";
import { BAKERY_ASSETS, BakeryMapData, TileLayer } from "./bakeryMap";

const MAP_KEY = "bakery-map";
const TILE_SIZE = 64;
const MAP_OFFSET = { x: 9, y: 9 };
const ROOM_SIZE = 6;
const ISO_CONFIG: IsoConfig = {
  tileWidth: TILE_SIZE,
  tileHeight: TILE_SIZE / 2,
  originX: 640,
  originY: 205,
};

const FURNITURE_LAYERS = new Set([
  "bitki", "Mobilya", "mobilya5", "mabilya4", "mobilya3", "mabilya2",
]);

const WALL_LAYERS = new Set(["köşe", "Duvar"]);

const PILLAR_ALIGNMENT_X = -12.5;
const CHECKOUT_FORWARD_Y = 10;
const CASHIER_ALIGNMENT_X = 15;
const CASHIER_ALIGNMENT_Y = 30;

const COUNTER_ASSETS = new Set([
  "counter",
  "bakery-counter",
  "display-counter",
  "cake-case-full",
  "cake-case",
  "cash-register",
]);

export class RoomScene extends Phaser.Scene {
  private avatar!: IsoAvatar;
  private npc!: Phaser.GameObjects.Sprite;
  private hint!: Phaser.GameObjects.Text;
  private dialogue!: Phaser.GameObjects.DOMElement;
  private dialogueForm!: HTMLFormElement;
  private dialogueInput!: HTMLInputElement;
  private dialogueMessages!: HTMLElement;
  private dialogueStatus!: HTMLElement;
  private dialogueSubmit!: HTMLButtonElement;
  private readonly api = new PraglishApiClient();
  private blockedTiles = new Set<string>();
  private npcGrid = { x: 1, y: 1, z: 0 };
  private npcCollisionGrid = this.calculateNpcCollisionGrid();

  constructor() {
    super("RoomScene");
  }

  preload(): void {
    this.load.json(MAP_KEY, "assets/bakery/Firin_Haritasi.tmj");
    for (const asset of BAKERY_ASSETS) {
      this.load.image(asset.key, `assets/bakery/${asset.file}`);
    }
    this.load.spritesheet("player", "assets/characters/player-girl.png", {
      frameWidth: 125,
      frameHeight: 125,
    });
    this.load.spritesheet("bakery-npc", "assets/bakery/Character-Sheet.png", {
      frameWidth: 47,
      frameHeight: 86,
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#181525");
    this.createAnimations();
    this.renderMap(this.cache.json.get(MAP_KEY) as BakeryMapData);

    this.avatar = new IsoAvatar(this, { x: 4, y: 4, z: 0 }, {
      textureKey: "player",
      assetMode: "full8",
      isoConfig: ISO_CONFIG,
      moveSpeed: 3.5,
    });
    this.avatar.sprite.setOrigin(0.5, 0.88).setScale(0.39);

    this.createNpc();
    this.createUi();

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.dialogue.visible) this.handleClickToWalk(pointer.worldX, pointer.worldY);
    });
    this.input.keyboard?.on("keydown-E", () => {
      if (!this.dialogue.visible) this.tryInteract();
    });
    this.input.keyboard?.on("keydown-ESC", () => this.closeDialogue());
    this.input.keyboard?.on("keydown-L", () => {
      if (!this.dialogue.visible) this.scene.start("LibraryScene");
    });
  }

  update(): void {
    const distance = Math.hypot(
      this.avatar.grid.x - this.npcCollisionGrid.x,
      this.avatar.grid.y - this.npcCollisionGrid.y,
    );
    this.hint.setVisible(distance <= 1.5 && !this.dialogue.visible);
  }

  private createAnimations(): void {
    const directionColumns: Record<string, number> = {
      N: 1,
      NE: 3,
      E: 3,
      SE: 2,
      S: 2,
      SW: 0,
      W: 0,
      NW: 1,
    };

    for (const [direction, column] of Object.entries(directionColumns)) {
      const idleKey = `player_idle_${direction}`;
      const walkKey = `player_walk_${direction}`;
      if (!this.anims.exists(idleKey)) {
        this.anims.create({
          key: idleKey,
          frames: [{ key: "player", frame: 50 + column }],
          frameRate: 1,
        });
      }
      if (!this.anims.exists(walkKey)) {
        this.anims.create({
          key: walkKey,
          // Yalnizca iki temiz satiri kullan. Ara satirlarda bir onceki
          // karenin ayakkabi pikselleri hucrenin ustune tasiyor.
          frames: [0, 50].map((rowStart) => ({
            key: "player",
            frame: rowStart + column,
          })),
          frameRate: 6,
          repeat: -1,
          yoyo: true,
        });
      }
    }
  }

  private renderMap(map: BakeryMapData): void {
    const tileset = map.tilesets[0];
    if (!tileset) throw new Error("Bakery map has no tileset");
    const tileById = new Map(
      tileset.tiles.map((tile) => [
        tile.id,
        BAKERY_ASSETS.find((asset) => asset.file === this.fileName(tile.image)),
      ]),
    );

    for (const layer of map.layers) {
      if (layer.type === "tilelayer") this.renderLayer(layer, map.width, tileById);
    }
  }

  private renderLayer(
    layer: TileLayer,
    mapWidth: number,
    tileById: Map<number, (typeof BAKERY_ASSETS)[number] | undefined>,
  ): void {
    layer.data.forEach((rawGid, index) => {
      const gid = rawGid & 0x1fffffff;
      if (gid === 0) return;

      const gridX = index % mapWidth - MAP_OFFSET.x;
      const gridY = Math.floor(index / mapWidth) - MAP_OFFSET.y;
      const asset = tileById.get(gid - 1);
      if (!asset) return;

      const screen = gridToScreen({ x: gridX, y: gridY, z: 0 }, ISO_CONFIG);
      const layerOffsetX = layer.offsetx ?? 0;
      const layerOffsetY = layer.offsety ?? 0;
      const assetOffsetX = asset.key === "pillar" ? PILLAR_ALIGNMENT_X : 0;
      const assetOffsetY = asset.key === "cash-register" || asset.key === "footmat"
        ? CHECKOUT_FORWARD_Y
        : 0;
      const isFloor = layer.name === "Zemin" || layer.name === "zemin2";
      const sprite = this.add.image(
        screen.x + layerOffsetX + assetOffsetX,
        screen.y + layerOffsetY + assetOffsetY + (isFloor ? 0 : TILE_SIZE / 2),
        asset.key,
      );
      sprite.setOrigin(0.5, isFloor ? 0.5 : 1);
      if (COUNTER_ASSETS.has(asset.key)) sprite.setScale(0.84);
      sprite.setFlipX((rawGid & 0x80000000) !== 0);
      sprite.setDepth(
        isFloor
          ? -1000
          : WALL_LAYERS.has(layer.name)
            ? -500
            : calculateDepth({ x: gridX, y: gridY, z: 0 }) + 20,
      );

      if (FURNITURE_LAYERS.has(layer.name)) this.blockedTiles.add(`${gridX},${gridY}`);
    });
  }

  private createNpc(): void {
    const { x: cashierX, y: cashierY } = this.calculateNpcScreenPosition();
    this.npc = this.add.sprite(cashierX, cashierY, "bakery-npc", 0)
      .setOrigin(0.5, 0.92)
      .setScale(0.88)
      .setDepth(calculateDepth(this.npcCollisionGrid) + 2);
    this.add.text(cashierX, cashierY - 72, "Maya · Fırıncı", {
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      color: "#fff7df",
      backgroundColor: "#33264f",
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(99999);
    this.blockedTiles.add(`${this.npcCollisionGrid.x},${this.npcCollisionGrid.y}`);
  }

  private createUi(): void {
    this.add.text(24, 22, "PRAGLISH · BAKERY", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "22px",
      color: "#ffd166",
    }).setScrollFactor(0).setDepth(100000);
    this.add.text(24, 54, "Zemine tıkla · Maya'ya yaklaş ve E'ye bas · L: Library", {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      color: "#ddd7ef",
    }).setScrollFactor(0).setDepth(100000);

    this.hint = this.add.text(640, 660, "E  ·  TALK", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "18px",
      color: "#221932",
      backgroundColor: "#ffd166",
      padding: { x: 16, y: 9 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100000).setVisible(false);

    this.dialogue = this.add.dom(640, 590).createFromHTML(`
      <section class="dialogue-panel" aria-label="Maya ile konuşma">
        <header class="dialogue-header">
          <div><strong>MAYA</strong><span>BAKER · AI</span></div>
          <button class="dialogue-close" type="button" aria-label="Konuşmayı kapat">ESC · close</button>
        </header>
        <div class="dialogue-messages" aria-live="polite">
          <p class="dialogue-system">Write something in English to start the conversation.</p>
        </div>
        <div class="dialogue-status">Not connected</div>
        <form class="dialogue-form">
          <input aria-label="Maya'ya İngilizce mesaj" maxlength="240" autocomplete="off"
            placeholder="Type in English…" />
          <button type="submit">Send</button>
        </form>
      </section>
    `).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(100001).setVisible(false);

    const node = this.dialogue.node as HTMLElement;
    this.dialogueForm = node.querySelector(".dialogue-form") as HTMLFormElement;
    this.dialogueInput = node.querySelector("input") as HTMLInputElement;
    this.dialogueMessages = node.querySelector(".dialogue-messages") as HTMLElement;
    this.dialogueStatus = node.querySelector(".dialogue-status") as HTMLElement;
    this.dialogueSubmit = node.querySelector("button[type='submit']") as HTMLButtonElement;
    node.querySelector(".dialogue-close")?.addEventListener("click", () => this.closeDialogue());
    node.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.dialogueForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitDialogueTurn();
    });
  }

  private tryInteract(): void {
    const distance = Math.hypot(
      this.avatar.grid.x - this.npcCollisionGrid.x,
      this.avatar.grid.y - this.npcCollisionGrid.y,
    );
    if (distance <= 1.5) {
      this.dialogue.setVisible(true);
      this.dialogueInput.focus();
      this.dialogueStatus.textContent = "Connecting to Praglish…";
      void this.api.startSession()
        .then(() => {
          this.dialogueStatus.textContent = "Connected · English practice mode";
        })
        .catch((error: unknown) => {
          this.dialogueStatus.textContent = error instanceof Error ? error.message : "Connection failed";
        });
    }
  }

  private closeDialogue(): void {
    this.dialogue.setVisible(false);
    this.dialogueInput.blur();
  }

  private async submitDialogueTurn(): Promise<void> {
    const userText = this.dialogueInput.value.trim();
    if (!userText || this.dialogueSubmit.disabled) return;

    this.dialogueInput.value = "";
    this.appendMessage("YOU", userText, "user");
    this.setDialogueBusy(true);
    this.dialogueStatus.textContent = "Maya is thinking…";

    try {
      const result = await this.api.sendTurn(userText);
      this.renderTurnResult(result);
      this.dialogueStatus.textContent = result.accepted
        ? "Accepted · keep going!"
        : "Try the suggested correction";
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      this.appendMessage("SYSTEM", message, "error");
      this.dialogueStatus.textContent = "Connection failed · retry when the API is running";
    } finally {
      this.setDialogueBusy(false);
      this.dialogueInput.focus();
    }
  }

  private renderTurnResult(result: TurnResponse): void {
    this.appendMessage("MAYA", result.npc_response, "npc");
    if (!result.accepted && result.correction && result.correction !== result.npc_response) {
      this.appendMessage("SUGGESTION", result.correction, "feedback");
    }
    if (result.rewards && (result.rewards.gained_xp > 0 || result.rewards.gained_coins > 0)) {
      this.appendMessage(
        "REWARD",
        `+${result.rewards.gained_xp} XP · +${result.rewards.gained_coins} coins`,
        "reward",
      );
    }
  }

  private appendMessage(author: string, text: string, kind: string): void {
    this.dialogueMessages.querySelector(".dialogue-system")?.remove();
    const message = document.createElement("div");
    message.className = `dialogue-message ${kind}`;
    const label = document.createElement("strong");
    label.textContent = author;
    const copy = document.createElement("span");
    copy.textContent = text;
    message.append(label, copy);
    this.dialogueMessages.append(message);
    this.dialogueMessages.scrollTop = this.dialogueMessages.scrollHeight;
  }

  private setDialogueBusy(busy: boolean): void {
    this.dialogueInput.disabled = busy;
    this.dialogueSubmit.disabled = busy;
    this.dialogueSubmit.textContent = busy ? "…" : "Send";
  }

  private handleClickToWalk(screenX: number, screenY: number): void {
    const target = screenToGrid({ x: screenX, y: screenY }, ISO_CONFIG);
    const grid: PathfindingGrid = {
      width: ROOM_SIZE,
      height: ROOM_SIZE,
      isWalkable: (x, y) => x >= 0 && y >= 0 && x < ROOM_SIZE && y < ROOM_SIZE
        && !this.blockedTiles.has(`${x},${y}`),
    };
    const path = findPath(grid, this.avatar.grid, target);
    if (!path) return;
    this.avatar.followPath(path.map(({ x, y }) => ({ x, y, z: 0 })));
  }

  private calculateNpcScreenPosition(): { x: number; y: number } {
    const screen = gridToScreen(this.npcGrid, ISO_CONFIG);
    return {
      x: screen.x + CASHIER_ALIGNMENT_X,
      y: screen.y + CASHIER_ALIGNMENT_Y,
    };
  }

  private calculateNpcCollisionGrid(): { x: number; y: number; z: number } {
    return screenToGrid(this.calculateNpcScreenPosition(), ISO_CONFIG);
  }

  private fileName(path: string): string {
    return path.replace(/\\/g, "/").split("/").pop() ?? path;
  }
}
