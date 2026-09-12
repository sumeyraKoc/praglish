import { describe, expect, it } from "vitest";
import { calculateDepth, sortByDepth } from "../DepthSort";

describe("DepthSort", () => {
  it("gives a higher depth to the entity farther forward on the grid", () => {
    const front = calculateDepth({ x: 5, y: 5, z: 0 });
    const back = calculateDepth({ x: 1, y: 1, z: 0 });
    expect(front).toBeGreaterThan(back);
  });

  it("draws a higher z value above another entity on the same tile", () => {
    const higher = calculateDepth({ x: 2, y: 2, z: 1 });
    const lower = calculateDepth({ x: 2, y: 2, z: 0 });
    expect(higher).toBeGreaterThan(lower);
  });

  it("sortByDepth orders the list by ascending depth", () => {
    const entities = [
      { id: "front", grid: { x: 5, y: 5, z: 0 } },
      { id: "back", grid: { x: 0, y: 0, z: 0 } },
      { id: "middle", grid: { x: 2, y: 2, z: 0 } },
    ];
    const sorted = sortByDepth(entities).map((e) => e.id);
    expect(sorted).toEqual(["back", "middle", "front"]);
  });

  it("sortByDepth returns a new array without mutating the original", () => {
    const entities = [
      { id: "a", grid: { x: 1, y: 1, z: 0 } },
      { id: "b", grid: { x: 0, y: 0, z: 0 } },
    ];
    const sorted = sortByDepth(entities);
    expect(sorted).not.toBe(entities);
    expect(entities.map((e) => e.id)).toEqual(["a", "b"]);
  });
});
