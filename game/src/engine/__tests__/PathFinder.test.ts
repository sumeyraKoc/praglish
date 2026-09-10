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
  it("bos grid'de duz yol bulunur (4 adim)", () => {
    const emptyGrid = makeGrid(5, 5, new Set());
    const path = findPath(emptyGrid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    expect(path).toHaveLength(4);
  });

  it("baslangic hedefle ayniysa bos yol doner", () => {
    const emptyGrid = makeGrid(5, 5, new Set());
    const path = findPath(emptyGrid, { x: 2, y: 2 }, { x: 2, y: 2 });
    expect(path).toEqual([]);
  });

  it("kose kesme testi: iki yani da blok olan capraz hedefe ulasilamaz", () => {
    // L-seklinde engel: (1,0) ve (0,1) blok -> (0,0)'dan (1,1)'e capraz gitmek
    // kose kesmek olur, bu YASAK olmali; dolasarak da baska yol yok.
    const cornerBlocked = makeGrid(3, 3, new Set(["1,0", "0,1"]));
    const path = findPath(cornerBlocked, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(path).toBeNull();
  });

  it("sadece tek yani blok olan capraz hareket yasak degildir (alternatif yol bulunur)", () => {
    const oneSideBlocked = makeGrid(3, 3, new Set(["1,0"]));
    const path = findPath(oneSideBlocked, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(path).not.toBeNull();
  });

  it("tamamen cevrili hedefe yol bulunamaz (null doner)", () => {
    const surrounded = makeGrid(3, 3, new Set(["0,1", "1,0", "1,1"]));
    const path = findPath(surrounded, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toBeNull();
  });

  it("hedefin kendisi duvarsa null doner", () => {
    const grid = makeGrid(3, 3, new Set(["2,2"]));
    const path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toBeNull();
  });
});
