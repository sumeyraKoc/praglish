import Phaser from "phaser";
import { calculateDepth } from "../engine/DepthSort";
import { gridToScreen, IsoConfig, screenToGrid } from "../engine/IsometricMath";
import { findPath, PathfindingGrid } from "../engine/PathFinder";
import { IsoAvatar } from "../entities/IsoAvatar";
import { PraglishApiClient, TurnResponse } from "../services/PraglishApiClient";
import { LIBRARY_ASSETS, LibraryMapData, LibraryTileLayer } from "./libraryMap";

const MAP_KEY = "library-map";
const TILE_SIZE = 64;
const ASSET_SCALE = TILE_SIZE / 256;
const FURNITURE_SCALE = ASSET_SCALE * 1.22;
const MAP_OFFSET = { x: 25, y: 14 };
const ROOM_SIZE = { width: 12, height: 16 };
const NAV_SUBDIVISIONS = 4;
// Yanim yana duran mobilyalarin collider'lari hafifce ust uste gelir;
// boylece karakter masa ve raf parcalarinin arasindaki yapay bosluga giremez.
const FURNITURE_COLLISION_RADIUS = 0.52;
const ISO_CONFIG: IsoConfig = {
  tileWidth: TILE_SIZE,
  tileHeight: TILE_SIZE / 2,
  originX: 650,
  originY: 100,
};

const LIBRARIAN_GRID = { x: 8, y: 3, z: 0 };
const PLAYER_SCALE = 0.30;
const LIBRARIAN_SCALE = 0.052;

export class LibraryScene extends Phaser.Scene {
  private avatar!: IsoAvatar;
  private hint!: Phaser.GameObjects.Text;
  private dialogue!: Phaser.GameObjects.DOMElement;
  private dialogueForm!: HTMLFormElement;
  private dialogueInput!: HTMLInputElement;
  private dialogueMessages!: HTMLElement;
  private dialogueStatus!: HTMLElement;
  private dialogueSubmit!: HTMLButtonElement;
  private readonly api = new PraglishApiClient({
    location: "library",
    npcRole: "librarian",
    npcName: "Lina",
  });
  private walkableTiles = new Set<string>();
  private wallTiles = new Set<string>();
  private furnitureTiles = new Set<string>();

  constructor() {
    super("LibraryScene");
  }

  preload(): void {
    this.load.json(MAP_KEY, "assets/library/Sample.tmj");
    for (const asset of LIBRARY_ASSETS) {
      this.load.image(asset.key, `assets/library/${asset.file}`);
    }
    this.load.image("library-npc", "assets/library/librarian-npc.png");
    this.load.spritesheet("player", "assets/characters/player-girl.png", {
      frameWidth: 125,
      frameHeight: 125,
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#292a2d");
    this.createPlayerAnimations();
    this.renderMap(this.cache.json.get(MAP_KEY) as LibraryMapData);

    this.avatar = new IsoAvatar(this, { x: 10, y: 14, z: 0 }, {
      textureKey: "player",
      assetMode: "full8",
      isoConfig: ISO_CONFIG,
      moveSpeed: 3.5,
    });
    this.avatar.sprite.setOrigin(0.5, 0.88).setScale(PLAYER_SCALE);

    this.createLibrarian();
    this.createUi();

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.dialogue.visible) this.handleClickToWalk(pointer.worldX, pointer.worldY);
    });
    this.input.keyboard?.on("keydown-E", () => {
      if (!this.dialogue.visible) this.tryInteract();
    });
    this.input.keyboard?.on("keydown-ESC", () => this.closeDialogue());
    this.input.keyboard?.on("keydown-B", () => {
      if (!this.dialogue.visible) this.scene.start("RoomScene");
    });
  }

  update(): void {
    const distance = Math.hypot(
      this.avatar.grid.x - LIBRARIAN_GRID.x,
      this.avatar.grid.y - LIBRARIAN_GRID.y,
    );
    this.hint.setVisible(distance <= 1.5 && !this.dialogue.visible);
  }

  private createPlayerAnimations(): void {
    const directionColumns: Record<string, number> = {
      N: 1, NE: 3, E: 3, SE: 2, S: 2, SW: 0, W: 0, NW: 1,
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
          frames: [0, 50].map((rowStart) => ({ key: "player", frame: rowStart + column })),
          frameRate: 6,
          repeat: -1,
          yoyo: true,
        });
      }
    }
  }

  private renderMap(map: LibraryMapData): void {
    const assetByGid = new Map(LIBRARY_ASSETS.map((asset) => [asset.gid, asset]));
    const layerOrder = new Map([
      ["Floor", -1000],
      ["Second floor", -900],
      ["Walls", 0],
      ["mobilyalar", 10],
    ]);

    for (const layer of map.layers) {
      if (layer.type !== "tilelayer") continue;
      this.renderLayer(layer, map.width, assetByGid, layerOrder.get(layer.name) ?? 0);
    }
  }

  private renderLayer(
    layer: LibraryTileLayer,
    mapWidth: number,
    assetByGid: Map<number, (typeof LIBRARY_ASSETS)[number]>,
    depthOffset: number,
  ): void {
    layer.data.forEach((rawGid, index) => {
      const gid = rawGid & 0x1fffffff;
      if (!gid) return;
      const asset = assetByGid.get(gid);
      if (!asset) return;

      const gridX = index % mapWidth - MAP_OFFSET.x;
      const gridY = Math.floor(index / mapWidth) - MAP_OFFSET.y;
      const tileKey = `${gridX},${gridY}`;
      if (layer.name === "Floor") this.walkableTiles.add(tileKey);
      if (layer.name === "Walls") this.wallTiles.add(tileKey);
      if (layer.name === "mobilyalar") this.furnitureTiles.add(tileKey);

      const screen = gridToScreen({ x: gridX, y: gridY, z: 0 }, ISO_CONFIG);
      const sprite = this.add.image(
        screen.x + (layer.offsetx ?? 0) * ASSET_SCALE,
        screen.y + TILE_SIZE / 4 + (layer.offsety ?? 0) * ASSET_SCALE,
        asset.key,
      );
      sprite.setOrigin(0.5, 1).setScale(
        layer.name === "mobilyalar" ? FURNITURE_SCALE : ASSET_SCALE,
      );
      sprite.setFlipX((rawGid & 0x80000000) !== 0);
      sprite.setFlipY((rawGid & 0x40000000) !== 0);
      sprite.setDepth(
        layer.name === "Floor" || layer.name === "Second floor"
          ? depthOffset
          : calculateDepth({ x: gridX, y: gridY, z: 0 }) + depthOffset,
      );
    });
  }

  private createLibrarian(): void {
    const screen = gridToScreen(LIBRARIAN_GRID, ISO_CONFIG);
    this.add.image(screen.x, screen.y + 16, "library-npc")
      .setOrigin(0.5, 0.9)
      .setScale(LIBRARIAN_SCALE)
      .setDepth(calculateDepth(LIBRARIAN_GRID) + 2);
    this.add.text(screen.x, screen.y - 65, "Lina · Librarian", {
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      color: "#fff8df",
      backgroundColor: "#4a2732",
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(99999);
    this.furnitureTiles.add(`${LIBRARIAN_GRID.x},${LIBRARIAN_GRID.y}`);
  }

  private createUi(): void {
    this.add.text(24, 22, "PRAGLISH · LIBRARY", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "22px",
      color: "#f2c879",
    }).setScrollFactor(0).setDepth(100000);
    this.add.text(24, 54, "Zemine tıkla · Lina'ya yaklaş ve E'ye bas · B: Bakery", {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      color: "#e1d9cb",
    }).setScrollFactor(0).setDepth(100000);

    this.hint = this.add.text(640, 660, "E  ·  TALK", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "18px",
      color: "#291c20",
      backgroundColor: "#f2c879",
      padding: { x: 16, y: 9 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100000).setVisible(false);

    this.dialogue = this.add.dom(640, 590).createFromHTML(`
      <section class="dialogue-panel" aria-label="Lina ile konuşma">
        <header class="dialogue-header">
          <div><strong>LINA</strong><span>LIBRARIAN · AI</span></div>
          <button class="dialogue-close" type="button" aria-label="Konuşmayı kapat">ESC · close</button>
        </header>
        <div class="dialogue-messages" aria-live="polite">
          <p class="dialogue-system">Ask Lina for a book in English.</p>
        </div>
        <div class="dialogue-status">Not connected</div>
        <form class="dialogue-form">
          <input aria-label="Lina'ya İngilizce mesaj" maxlength="240" autocomplete="off"
            placeholder="Type in English…" />
          <button type="submit">Send</button>
        </form>
      </section>
    `).setOrigin(0.5).setScrollFactor(0).setDepth(100001).setVisible(false);

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
      this.avatar.grid.x - LIBRARIAN_GRID.x,
      this.avatar.grid.y - LIBRARIAN_GRID.y,
    );
    if (distance <= 1.5) {
      this.dialogue.setVisible(true);
      this.dialogueInput.focus();
      this.dialogueStatus.textContent = "Connecting to Praglish…";
      void this.api.startSession()
        .then(() => {
          this.dialogueStatus.textContent = "Connected · Library practice mode";
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
    this.dialogueStatus.textContent = "Lina is thinking…";

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
    this.appendMessage("LINA", result.npc_response, "npc");
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
    const target = screenToGrid(
      { x: screenX, y: screenY },
      ISO_CONFIG,
      NAV_SUBDIVISIONS,
    );
    const navStart = {
      x: Math.round(this.avatar.grid.x * NAV_SUBDIVISIONS),
      y: Math.round(this.avatar.grid.y * NAV_SUBDIVISIONS),
    };
    const navTarget = {
      x: Math.round(target.x * NAV_SUBDIVISIONS),
      y: Math.round(target.y * NAV_SUBDIVISIONS),
    };
    const grid: PathfindingGrid = {
      width: (ROOM_SIZE.width - 1) * NAV_SUBDIVISIONS + 1,
      height: (ROOM_SIZE.height - 1) * NAV_SUBDIVISIONS + 1,
      isWalkable: (x, y) => this.isNavigationPointWalkable(x, y),
    };
    const path = findPath(grid, navStart, navTarget);
    if (!path) return;
    this.avatar.followPath(path.map(({ x, y }) => ({
      x: x / NAV_SUBDIVISIONS,
      y: y / NAV_SUBDIVISIONS,
      z: 0,
    })));
  }

  private isNavigationPointWalkable(navX: number, navY: number): boolean {
    const worldX = navX / NAV_SUBDIVISIONS;
    const worldY = navY / NAV_SUBDIVISIONS;
    const nearestTile = `${Math.round(worldX)},${Math.round(worldY)}`;
    if (!this.walkableTiles.has(nearestTile) || this.wallTiles.has(nearestTile)) return false;

    // Mobilyalar gorsel olarak buyutuldugu icin merkezlerinin etrafinda
    // karakter olcegine uygun dar bir guvenlik payi birak.
    for (const tile of this.furnitureTiles) {
      const [xText, yText] = tile.split(",");
      if (xText === undefined || yText === undefined) continue;
      const furnitureX = Number(xText);
      const furnitureY = Number(yText);
      if (Math.hypot(worldX - furnitureX, worldY - furnitureY) <= FURNITURE_COLLISION_RADIUS) {
        return false;
      }
    }
    return true;
  }
}
