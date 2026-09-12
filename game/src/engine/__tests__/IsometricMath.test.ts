import { describe, expect, it } from "vitest";
import { DEFAULT_ISO_CONFIG, gridToScreen, screenToGrid } from "../IsometricMath";

describe("IsometricMath", () => {
  it("maps grid position (0,0,0) to the screen origin", () => {
    expect(gridToScreen({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("supports a reversible grid-to-screen round trip", () => {
    const someGrid = { x: 3, y: 5, z: 0 };
    const screen = gridToScreen(someGrid, DEFAULT_ISO_CONFIG);
    const backToGrid = screenToGrid(screen, DEFAULT_ISO_CONFIG);
    expect(backToGrid).toEqual(someGrid);
  });

  it("uses subdivisions for half-tile precision", () => {
    const halfTile = screenToGrid({ x: 16, y: 8 }, DEFAULT_ISO_CONFIG, 2);
    expect(halfTile).toEqual({ x: 0.5, y: 0, z: 0 });
  });

  it("moves screen Y upward by tileHeight for each z level", () => {
    const ground = gridToScreen({ x: 0, y: 0, z: 0 });
    const raised = gridToScreen({ x: 0, y: 0, z: 1 });
    expect(raised.y).toBe(ground.y - DEFAULT_ISO_CONFIG.tileHeight);
  });

  it("applies a custom origin offset", () => {
    const config = { ...DEFAULT_ISO_CONFIG, originX: 100, originY: 50 };
    expect(gridToScreen({ x: 0, y: 0, z: 0 }, config)).toEqual({ x: 100, y: 50 });
  });
});
