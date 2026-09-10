import { describe, expect, it } from "vitest";
import { DEFAULT_ISO_CONFIG, gridToScreen, screenToGrid } from "../IsometricMath";

describe("IsometricMath", () => {
  it("grid (0,0,0) her zaman ekran origin'ine denk gelir", () => {
    expect(gridToScreen({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("grid -> screen -> grid donusumu tersine cevrilebilir (round-trip)", () => {
    const someGrid = { x: 3, y: 5, z: 0 };
    const screen = gridToScreen(someGrid, DEFAULT_ISO_CONFIG);
    const backToGrid = screenToGrid(screen, DEFAULT_ISO_CONFIG);
    expect(backToGrid).toEqual(someGrid);
  });

  it("screenToGrid subdivisions ile yarim-karo hassasiyeti verir", () => {
    const halfTile = screenToGrid({ x: 16, y: 8 }, DEFAULT_ISO_CONFIG, 2);
    expect(halfTile).toEqual({ x: 0.5, y: 0, z: 0 });
  });

  it("z yuksekligi ekran Y'sini tileHeight kadar yukari tasir", () => {
    const ground = gridToScreen({ x: 0, y: 0, z: 0 });
    const raised = gridToScreen({ x: 0, y: 0, z: 1 });
    expect(raised.y).toBe(ground.y - DEFAULT_ISO_CONFIG.tileHeight);
  });

  it("custom origin ofseti dogru uygulanir", () => {
    const config = { ...DEFAULT_ISO_CONFIG, originX: 100, originY: 50 };
    expect(gridToScreen({ x: 0, y: 0, z: 0 }, config)).toEqual({ x: 100, y: 50 });
  });
});
