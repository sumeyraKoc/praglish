import { describe, expect, it } from "vitest";
import { findPath, PathfindingGrid } from "../PathFinder";

function makeGrid(width: number, height: number, blocked: Set<string>): PathfindingGrid {
  return {
    width,
    height,
    isWalkable(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      return !blocked.has(`${x},${y}`);
    },
  };
}

describe("PathFinder", () => {
  it("finds a straight four-step path on an empty grid", () => {
    const emptyGrid = makeGrid(5, 5, new Set());
    const path = findPath(emptyGrid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    expect(path).toHaveLength(4);
  });

  it("returns an empty path when the start equals the destination", () => {
    const emptyGrid = makeGrid(5, 5, new Set());
    const path = findPath(emptyGrid, { x: 2, y: 2 }, { x: 2, y: 2 });
    expect(path).toEqual([]);
  });

  it("cannot cut a corner when both adjacent sides are blocked", () => {
    const cornerBlocked = makeGrid(3, 3, new Set(["1,0", "0,1"]));
    const path = findPath(cornerBlocked, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(path).toBeNull();
  });

  it("finds an alternative diagonal path when only one side is blocked", () => {
    const oneSideBlocked = makeGrid(3, 3, new Set(["1,0"]));
    const path = findPath(oneSideBlocked, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(path).not.toBeNull();
  });

  it("returns null for a fully enclosed destination", () => {
    const surrounded = makeGrid(3, 3, new Set(["0,1", "1,0", "1,1"]));
    const path = findPath(surrounded, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toBeNull();
  });

  it("returns null when the destination itself is blocked", () => {
    const grid = makeGrid(3, 3, new Set(["2,2"]));
    const path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toBeNull();
  });
});
