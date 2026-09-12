import Phaser from "phaser";
import { calculateDepth } from "../engine/DepthSort";
import { gridToScreen, IsoConfig, screenToGrid } from "../engine/IsometricMath";
import { findPath, PathfindingGrid } from "../engine/PathFinder";
import { IsoAvatar } from "../entities/IsoAvatar";
import { isTextEntryEvent } from "../engine/DomInputGuard";
import { attachDialogueScrollControls } from "../ui/DialogueScrollControls";
import { getRememberedDialogue, rememberDialogueMessage } from "../services/RoleplayMemory";
import {
  PraglishApiClient,
  ROLEPLAY_TTS_PROFILES,
  TurnResponse,
  VocabularyProgressEntry,
  VocabularySubmitResponse,
} from "../services/PraglishApiClient";
import { ASSET_CONCEPT, BAKERY_ASSETS, BakeryMapData, TileLayer } from "./bakeryMap";

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
  "Plants", "Furniture", "Furniture 5", "Furniture 4", "Furniture 3", "Furniture 2",
]);

const WALL_LAYERS = new Set(["Corners", "Walls"]);

const PILLAR_ALIGNMENT_X = -12.5;
const CASHIER_ALIGNMENT_X = 15;
const CASHIER_ALIGNMENT_Y = 30;


const CAKE_CASE_GAP_GRID = { x: 3, y: 2 };

const INTERACT_RANGE = 1.5;

interface Interactable {
  x: number;
  y: number;
  concept: string;
}

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
  private dialogueMic!: HTMLButtonElement;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: BlobPart[] = [];
  private isRecording = false;
  private currentNpcAudio: HTMLAudioElement | null = null;
  private readonly api = new PraglishApiClient();
  private blockedTiles = new Set<string>();
  private npcGrid = { x: 1, y: 1, z: 0 };
  private npcCollisionGrid = this.calculateNpcCollisionGrid();

  private interactables: Interactable[] = [];
  private interactableTileKeys = new Set<string>();
  private earnedWords = new Map<string, Set<string>>();
  private nearestInteractable: Interactable | null = null;
  private vocabHint!: Phaser.GameObjects.Text;
  private vocabPanel!: Phaser.GameObjects.DOMElement;
  private vocabForm!: HTMLFormElement;
  private vocabInput!: HTMLInputElement;
  private vocabMessages!: HTMLElement;
  private vocabStatus!: HTMLElement;
  private vocabSubmit!: HTMLButtonElement;
  private vocabActiveConcept: string | null = null;

  constructor() {
    super("RoomScene");
  }

  preload(): void {
    this.load.json(MAP_KEY, "assets/bakery/Bakery_Map.tmj");
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
    this.blockedTiles.add(`${CAKE_CASE_GAP_GRID.x},${CAKE_CASE_GAP_GRID.y}`);

    this.avatar = new IsoAvatar(this, { x: 4, y: 4, z: 0 }, {
      textureKey: "player",
      assetMode: "full8",
      isoConfig: ISO_CONFIG,
      moveSpeed: 3.5,
    });
    this.avatar.sprite.setOrigin(0.5, 0.88).setScale(0.39);

    this.createNpc();
    this.createUi();
    void this.loadVocabularyProgress();

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.dialogue.visible) {
        this.closeDialogue();
        return;
      }
      if (this.vocabPanel.visible) {
        this.closeVocabPanel();
        return;
      }
      this.handleClickToWalk(pointer.worldX, pointer.worldY);
    });
    this.input.keyboard?.on("keydown-E", (event: KeyboardEvent) => {
      if (!isTextEntryEvent(event)) this.handleInteractKey();
    });
    this.input.keyboard?.on("keydown-ESC", (event: KeyboardEvent) => {
      if (isTextEntryEvent(event)) return;
      this.closeDialogue();
      this.closeVocabPanel();
    });
    this.input.keyboard?.on("keydown-L", (event: KeyboardEvent) => {
      if (isTextEntryEvent(event)) return;
      if (!this.dialogue.visible && !this.vocabPanel.visible) this.scene.start("LibraryScene");
    });
    this.input.keyboard?.on("keydown-M", (event: KeyboardEvent) => {
      if (isTextEntryEvent(event)) return;
      if (!this.dialogue.visible && !this.vocabPanel.visible) this.scene.start("MenuScene");
    });
    this.input.keyboard?.on("keydown-P", (event: KeyboardEvent) => {
      if (isTextEntryEvent(event)) return;
      if (!this.dialogue.visible && !this.vocabPanel.visible) {
        this.scene.start("DashboardScene", { returnScene: "RoomScene" });
      }
    });
  }

  update(): void {
    const npcDistance = Math.hypot(
      this.avatar.grid.x - this.npcCollisionGrid.x,
      this.avatar.grid.y - this.npcCollisionGrid.y,
    );
    const npcNear = npcDistance <= INTERACT_RANGE;
    const panelOpen = this.dialogue.visible || this.vocabPanel.visible;

    this.hint.setVisible(npcNear && !panelOpen);

    this.nearestInteractable = npcNear ? null : this.findNearestInteractable();
    this.vocabHint.setVisible(!npcNear && !panelOpen && this.nearestInteractable !== null);
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
      const assetOffsetX = asset.key === "pillar" 
        ? PILLAR_ALIGNMENT_X 
        : 0;
      const isFloor = layer.name === "Floor" || layer.name === "Floor 2";
      const sprite = this.add.image(
        screen.x + layerOffsetX + assetOffsetX,
        screen.y + layerOffsetY + (isFloor ? 0 : TILE_SIZE / 2),
        asset.key,
      );
      sprite.setOrigin(0.5, isFloor ? 0.5 : 1);
      sprite.setFlipX((rawGid & 0x80000000) !== 0);
      sprite.setDepth(
        isFloor
          ? -1000
          : WALL_LAYERS.has(layer.name)
            ? -500
            : calculateDepth({ x: gridX, y: gridY, z: 0 }) + 20,
      );

      if (FURNITURE_LAYERS.has(layer.name)) {
        this.blockedTiles.add(`${gridX},${gridY}`);
      }

      this.registerInteractable(asset.key, gridX, gridY);
    });
  }

  private registerInteractable(assetKey: string, gridX: number, gridY: number): void {
    const concept = ASSET_CONCEPT[assetKey];
    if (!concept) return;
    const tileKey = `${gridX},${gridY}`;
    if (this.interactableTileKeys.has(tileKey)) return;
    this.interactableTileKeys.add(tileKey);
    this.interactables.push({ x: gridX, y: gridY, concept });
  }

  private findNearestInteractable(): Interactable | null {
    let nearest: Interactable | null = null;
    let nearestDistance = Infinity;
    for (const item of this.interactables) {
      const distance = Math.hypot(this.avatar.grid.x - item.x, this.avatar.grid.y - item.y);
      if (distance <= INTERACT_RANGE && distance < nearestDistance) {
        nearest = item;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private async loadVocabularyProgress(): Promise<void> {
    try {
      const progress = await this.api.getVocabularyProgress();
      this.applyVocabularyProgress(progress);
      this.warnOnUnknownConcepts(progress);
    } catch {
    }
  }

  private warnOnUnknownConcepts(progress: VocabularyProgressEntry[]): void {
    const knownConcepts = new Set(progress.map((entry) => entry.concept));
    const usedConcepts = new Set(this.interactables.map((item) => item.concept));
    const unknown = [...usedConcepts].filter((concept) => !knownConcepts.has(concept));
    if (unknown.length > 0) {
      console.warn(
        "[Praglish] bakeryMap.ts > ASSET_CONCEPT bu concept'leri kullaniyor ama " +
          `They are not defined in api/game_data/vocabulary/bakery.json: ${unknown.join(", ")}. ` +
          "Players cannot earn coins for these objects until the two files are synchronized.",
      );
    }
  }

  private applyVocabularyProgress(progress: VocabularyProgressEntry[]): void {
    for (const entry of progress) {
      const earned = new Set(
        entry.words.filter((w) => w.earned).map((w) => w.word.toLowerCase()),
      );
      this.earnedWords.set(entry.concept, earned);
    }
  }

  private createNpc(): void {
    const { x: cashierX, y: cashierY } = this.calculateNpcScreenPosition();
    this.npc = this.add.sprite(cashierX, cashierY, "bakery-npc", 0)
      .setOrigin(0.5, 0.92)
      .setScale(0.88)
      .setDepth(calculateDepth(this.npcCollisionGrid) + 2);
    this.add.text(cashierX, cashierY - 72, "Maya · Baker", {
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      color: "#fff7df",
      backgroundColor: "#33264f",
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(99999);
  }

  private createUi(): void {
    this.add.text(24, 22, "PRAGLISH · BAKERY", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "22px",
      color: "#ffd166",
    }).setScrollFactor(0).setDepth(100000);
    this.add.text(24, 54, "Click the floor · E: Interact · L: Library · P: Progress · M: Menu", {
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
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100000).setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        this.tryInteract();
      });

    this.vocabHint = this.add.text(640, 660, "E  ·  WHAT’S THIS IN ENGLISH?", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "18px",
      color: "#182219",
      backgroundColor: "#8fd3a5",
      padding: { x: 16, y: 9 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100000).setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        if (this.nearestInteractable) {
          this.openVocabPanel(this.nearestInteractable.concept);
        }
      });

    this.dialogue = this.add.dom(640, 590).createFromHTML(`
      <section class="dialogue-panel" aria-label="Conversation with Maya">
        <header class="dialogue-header">
          <div><strong>MAYA</strong><span>BAKER · AI</span></div>
          <button class="dialogue-close" type="button" aria-label="Close conversation">ESC · close</button>
        </header>
        <div class="dialogue-scrollable">
          <div class="dialogue-messages" aria-live="polite">
            <p class="dialogue-system">Write something in English to start the conversation.</p>
          </div>
          <div class="dialogue-scroll-controls" aria-label="Scroll conversation history">
            <button class="dialogue-scroll-button up" type="button" data-scroll-direction="up" aria-label="Scroll up"></button>
            <span class="dialogue-scroll-track" aria-hidden="true"></span>
            <button class="dialogue-scroll-button down" type="button" data-scroll-direction="down" aria-label="Scroll down"></button>
          </div>
        </div>
        <div class="dialogue-status">Not connected</div>
        <form class="dialogue-form">
          <input aria-label="English message to Maya" maxlength="240" autocomplete="off"
            placeholder="Type in English…" />
          <button type="button" class="dialogue-mic" aria-label="Record a spoken message">🎤</button>
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
    this.dialogueMic = node.querySelector(".dialogue-mic") as HTMLButtonElement;
    this.restoreDialogueMessages();
    attachDialogueScrollControls(node, this.dialogueMessages);
    this.dialogueMic.addEventListener("click", () => void this.toggleRecording());
    node.querySelector(".dialogue-close")?.addEventListener("click", () => this.closeDialogue());
    node.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.dialogueForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.isRecording) {
        this.stopRecording();
        return;
      }
      void this.submitDialogueTurn();
    });

    this.vocabPanel = this.add.dom(640, 590).createFromHTML(`
      <section class="dialogue-panel vocab-panel" aria-label="Name an object">
        <header class="dialogue-header">
          <div><strong>WHAT’S THIS IN ENGLISH?</strong><span>VOCABULARY PRACTICE</span></div>
          <button class="dialogue-close" type="button" aria-label="Close">ESC · close</button>
        </header>
        <div class="dialogue-scrollable">
          <div class="dialogue-messages" aria-live="polite">
            <p class="dialogue-system">What is this called in English?</p>
          </div>
          <div class="dialogue-scroll-controls" aria-label="Scroll vocabulary history">
            <button class="dialogue-scroll-button up" type="button" data-scroll-direction="up" aria-label="Scroll up"></button>
            <span class="dialogue-scroll-track" aria-hidden="true"></span>
            <button class="dialogue-scroll-button down" type="button" data-scroll-direction="down" aria-label="Scroll down"></button>
          </div>
        </div>
        <div class="dialogue-status">Type the word and press Enter</div>
        <form class="dialogue-form">
          <input aria-label="Object name in English" maxlength="60" autocomplete="off"
            placeholder="e.g. bread" />
          <button type="submit">Submit</button>
        </form>
      </section>
    `).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(100001).setVisible(false);

    const vocabNode = this.vocabPanel.node as HTMLElement;
    this.vocabForm = vocabNode.querySelector(".dialogue-form") as HTMLFormElement;
    this.vocabInput = vocabNode.querySelector("input") as HTMLInputElement;
    this.vocabMessages = vocabNode.querySelector(".dialogue-messages") as HTMLElement;
    this.vocabStatus = vocabNode.querySelector(".dialogue-status") as HTMLElement;
    this.vocabSubmit = vocabNode.querySelector("button[type='submit']") as HTMLButtonElement;
    attachDialogueScrollControls(vocabNode, this.vocabMessages);
    vocabNode.querySelector(".dialogue-close")?.addEventListener("click", () => this.closeVocabPanel());
    vocabNode.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.vocabForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitVocabWord();
    });
  }

  private handleInteractKey(): void {
    if (this.dialogue.visible || this.vocabPanel.visible) return;

    const npcDistance = Math.hypot(
      this.avatar.grid.x - this.npcCollisionGrid.x,
      this.avatar.grid.y - this.npcCollisionGrid.y,
    );
    if (npcDistance <= INTERACT_RANGE) {
      this.tryInteract();
      return;
    }
    if (this.nearestInteractable) {
      this.openVocabPanel(this.nearestInteractable.concept);
    }
  }

  private tryInteract(): void {
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

  private closeDialogue(): void {
    if (this.isRecording) this.stopRecording();
    this.currentNpcAudio?.pause();
    this.dialogue.setVisible(false);
    this.dialogueInput.blur();
  }

  private async toggleRecording(): Promise<void> {
    if (this.isRecording) {
      this.stopRecording();
      return;
    }
    if (this.dialogueSubmit.disabled || this.dialogueMic.disabled) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      this.dialogueStatus.textContent = "Microphone is not supported in this browser.";
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      this.audioChunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        void this.handleRecordedAudio();
      });
      this.mediaRecorder = recorder;
      recorder.start();
      this.isRecording = true;
      this.dialogueMic.textContent = "⏹";
      this.dialogueMic.setAttribute("aria-label", "Stop and send the spoken message");
      this.dialogueMic.classList.add("recording");
      this.dialogueStatus.textContent = "Recording… press stop or Send when you're done.";
    } catch {
      this.dialogueStatus.textContent = "Microphone access was denied.";
    }
  }

  private stopRecording(): void {
    this.mediaRecorder?.stop();
    this.isRecording = false;
    this.dialogueMic.textContent = "🎤";
    this.dialogueMic.setAttribute("aria-label", "Record a spoken message");
    this.dialogueMic.classList.remove("recording");
  }

  private async handleRecordedAudio(): Promise<void> {
    const recordedType = this.mediaRecorder?.mimeType || "audio/webm";
    const blob = new Blob(this.audioChunks, { type: recordedType });
    this.audioChunks = [];
    if (blob.size === 0) {
      this.dialogueStatus.textContent = "No audio captured - try again.";
      return;
    }

    this.dialogueMic.disabled = true;
    this.dialogueStatus.textContent = "Transcribing…";
    try {
      const { text } = await this.api.transcribeAudio(blob);
      if (!text.trim()) {
        this.dialogueStatus.textContent = "Couldn't hear anything - try again.";
        return;
      }
      this.dialogueInput.value = text;
      await this.submitDialogueTurn();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Speech recognition failed.";
      this.appendMessage("SYSTEM", message, "error");
      this.dialogueStatus.textContent = "Speech recognition failed.";
    } finally {
      this.dialogueMic.disabled = false;
    }
  }

  private async speakNpcResponse(text: string, isCoach: boolean): Promise<void> {
    try {
      const profile = isCoach ? ROLEPLAY_TTS_PROFILES.coach : ROLEPLAY_TTS_PROFILES.cafeNpc;
      const audioBlob = await this.api.synthesizeSpeech(text, profile);
      const url = URL.createObjectURL(audioBlob);
      if (this.currentNpcAudio) {
        this.currentNpcAudio.pause();
        URL.revokeObjectURL(this.currentNpcAudio.src);
      }
      const audio = new Audio(url);
      this.currentNpcAudio = audio;
      audio.addEventListener("ended", () => URL.revokeObjectURL(url));
      await audio.play();
    } catch {
    }
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
    const isCoach = result.response_speaker === "coach";
    this.appendMessage(
      isCoach ? "COACH" : "MAYA",
      result.npc_response,
      isCoach ? "feedback" : "npc",
    );
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
    void this.speakNpcResponse(result.npc_response, isCoach);
  }

  private restoreDialogueMessages(): void {
    const remembered = getRememberedDialogue("bakery");
    if (remembered.length === 0) return;
    this.dialogueMessages.innerHTML = "";
    remembered.forEach((message) => {
      this.appendMessage(message.author, message.text, message.kind, false);
    });
  }

  private appendMessage(author: string, text: string, kind: string, remember = true): void {
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
    if (remember) rememberDialogueMessage("bakery", { author, text, kind });
  }

  private setDialogueBusy(busy: boolean): void {
    this.dialogueInput.disabled = busy;
    this.dialogueSubmit.disabled = busy;
    this.dialogueSubmit.textContent = busy ? "…" : "Send";
  }


  private openVocabPanel(concept: string): void {
    this.vocabActiveConcept = concept;
    this.vocabMessages.innerHTML = "";
    const alreadyKnown = [...(this.earnedWords.get(concept) ?? [])];
    if (alreadyKnown.length > 0) {
      this.appendVocabMessage(
        "ALREADY LEARNED",
        `You already earned: ${alreadyKnown.join(", ")}. Try a synonym for more coins!`,
        "already",
      );
    } else {
      const system = document.createElement("p");
      system.className = "dialogue-system";
      system.textContent = "What is this called in English?";
      this.vocabMessages.append(system);
    }
    this.vocabStatus.textContent = "Type the word and press Enter";
    this.vocabInput.value = "";
    this.vocabPanel.setVisible(true);
    this.vocabHint.setVisible(false);
    this.vocabInput.focus();
  }

  private closeVocabPanel(): void {
    this.vocabPanel.setVisible(false);
    this.vocabInput.blur();
    this.vocabActiveConcept = null;
  }

  private async submitVocabWord(): Promise<void> {
    const word = this.vocabInput.value.trim();
    const concept = this.vocabActiveConcept;
    if (!word || !concept || this.vocabSubmit.disabled) return;

    this.vocabInput.value = "";
    this.appendVocabMessage("YOU", word, "user");
    this.setVocabBusy(true);
    this.vocabStatus.textContent = "Checking…";

    try {
      const result = await this.api.submitVocabulary(concept, word);
      this.renderVocabResult(concept, word, result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      this.appendVocabMessage("SYSTEM", message, "error");
      this.vocabStatus.textContent = "Connection failed · retry when the API is running";
    } finally {
      this.setVocabBusy(false);
      this.vocabInput.focus();
    }
  }

  private renderVocabResult(
    concept: string,
    word: string,
    result: VocabularySubmitResponse,
  ): void {
    if (!result.matched) {
      this.appendVocabMessage("HINT", "Not quite - try another word for this object.", "feedback");
      this.vocabStatus.textContent = "Try again";
      return;
    }

    if (result.already_earned) {
      this.appendVocabMessage("ALREADY LEARNED", `You already earned "${word}".`, "already");
      this.vocabStatus.textContent = "Try a different synonym for more coins";
      return;
    }

    const earned = this.earnedWords.get(concept) ?? new Set<string>();
    earned.add(word.toLowerCase());
    this.earnedWords.set(concept, earned);

    this.appendVocabMessage(
      "REWARD",
      `Correct! +${result.reward_coins} coins` +
        (result.words_total ? ` (${result.words_earned}/${result.words_total} words for this object)` : ""),
      "reward",
    );
    if (result.concept_completed) {
      this.appendVocabMessage("DONE", "All synonyms for this object are learned!", "already");
    }
    this.vocabStatus.textContent = "Nice! Try a synonym for more coins, or press ESC.";
  }

  private appendVocabMessage(author: string, text: string, kind: string): void {
    this.vocabMessages.querySelector(".dialogue-system")?.remove();
    const message = document.createElement("div");
    message.className = `dialogue-message ${kind}`;
    const label = document.createElement("strong");
    label.textContent = author;
    const copy = document.createElement("span");
    copy.textContent = text;
    message.append(label, copy);
    this.vocabMessages.append(message);
    this.vocabMessages.scrollTop = this.vocabMessages.scrollHeight;
  }

  private setVocabBusy(busy: boolean): void {
    this.vocabInput.disabled = busy;
    this.vocabSubmit.disabled = busy;
    this.vocabSubmit.textContent = busy ? "…" : "Submit";
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
