import Phaser from "phaser";
import { GridPosition, gridToScreen, IsoConfig } from "../engine/IsometricMath";
import { calculateDepth } from "../engine/DepthSort";
import { Direction8, resolveDirection } from "./DirectionResolver";

export interface IsoAvatarConfig {
  textureKey: string;
  assetMode: "full8" | "mirror4";
  isoConfig: IsoConfig;
  moveSpeed: number; // saniyede grid birimi
}

export class IsoAvatar {
  public sprite: Phaser.GameObjects.Sprite;
  public grid: GridPosition;

  private scene: Phaser.Scene;
  private config: IsoAvatarConfig;
  private currentDirection: Direction8 = "S";
  private targetPath: GridPosition[] = [];
  private isMoving = false;
  private activeTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, startGrid: GridPosition, config: IsoAvatarConfig) {
    this.scene = scene;
    this.grid = startGrid;
    this.config = config;

    const screenPos = gridToScreen(startGrid, config.isoConfig);
    this.sprite = scene.add.sprite(screenPos.x, screenPos.y, config.textureKey);
    this.sprite.setDepth(calculateDepth(startGrid));
    this.playIdle();
  }

  public followPath(path: GridPosition[]): void {
    this.activeTween?.stop();
    this.activeTween = null;
    this.targetPath = [...path];
    this.advanceToNextWaypoint();
  }

  private advanceToNextWaypoint(): void {
    const next = this.targetPath.shift();
    if (!next) {
      this.isMoving = false;
      this.playIdle();
      return;
    }

    const dx = next.x - this.grid.x;
    const dy = next.y - this.grid.y;
    const resolved = resolveDirection(dx, dy, this.config.assetMode);
    this.currentDirection = resolved.direction;
    this.sprite.setFlipX(resolved.flipX);

    const walkKey = `${this.config.textureKey}_walk_${resolved.spriteDirection}`;
    if (this.scene.anims.exists(walkKey)) {
      this.sprite.play(walkKey, true);
    }

    const targetScreen = gridToScreen(next, this.config.isoConfig);
    const distance = Math.hypot(dx, dy);
    const durationMs = (distance / this.config.moveSpeed) * 1000;

    this.isMoving = true;
    this.activeTween = this.scene.tweens.add({
      targets: this.sprite,
      x: targetScreen.x,
      y: targetScreen.y,
      duration: durationMs,
      ease: "Linear",
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        const progressGrid: GridPosition = {
          x: this.grid.x + (next.x - this.grid.x) * tween.progress,
          y: this.grid.y + (next.y - this.grid.y) * tween.progress,
          z: next.z,
        };
        this.sprite.setDepth(calculateDepth(progressGrid));
      },
      onComplete: () => {
        this.activeTween = null;
        this.grid = next;
        this.advanceToNextWaypoint();
      },
    });
  }

  private playIdle(): void {
    const vectors: Record<Direction8, { x: number; y: number }> = {
      N: { x: 0, y: -1 },
      NE: { x: 1, y: -1 },
      E: { x: 1, y: 0 },
      SE: { x: 1, y: 1 },
      S: { x: 0, y: 1 },
      SW: { x: -1, y: 1 },
      W: { x: -1, y: 0 },
      NW: { x: -1, y: -1 },
    };
    const facing = vectors[this.currentDirection];
    const resolved = resolveDirection(facing.x, facing.y, this.config.assetMode);
    const idleKey = `${this.config.textureKey}_idle_${resolved.spriteDirection}`;
    if (this.scene.anims.exists(idleKey)) {
      this.sprite.play(idleKey, true);
    }
    this.sprite.setFlipX(resolved.flipX);
  }

  public get moving(): boolean {
    return this.isMoving;
  }
}
