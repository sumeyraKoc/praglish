import { describe, expect, it } from "vitest";
import { allDirections, resolveDirection, vectorToDirection8 } from "../../entities/DirectionResolver";

describe("vectorToDirection8", () => {
  const cases: Array<[number, number, string]> = [
    [1, 0, "E"],
    [-1, 0, "W"],
    [0, -1, "N"],
    [0, 1, "S"],
    [1, 1, "SE"],
    [0, 0, "S"], // hareketsizken varsayilan S (kameraya bakar)
  ];

  it.each(cases)("vectorToDirection8(%i, %i) -> %s", (dx, dy, expected) => {
    expect(vectorToDirection8(dx, dy)).toBe(expected);
  });
});

describe("resolveDirection", () => {
  it("mirror4: W yonu, E sprite'ini flip ile kullanir", () => {
    const west = resolveDirection(-1, 0, "mirror4");
    expect(west.spriteDirection).toBe("E");
    expect(west.flipX).toBe(true);
  });

  it("mirror4: E yonunde flipX false olmali (orijinal sprite)", () => {
    const east = resolveDirection(1, 0, "mirror4");
    expect(east.flipX).toBe(false);
  });

  it("full8 modunda hic flip olmaz, her yon kendi sprite'ini kullanir", () => {
    const nw8 = resolveDirection(-1, -1, "full8");
    expect(nw8.spriteDirection).toBe("NW");
    expect(nw8.flipX).toBe(false);
  });
});

describe("allDirections", () => {
  it("toplam 8 yon tanimlidir", () => {
    expect(allDirections()).toHaveLength(8);
  });

  it("her cagrida yeni bir kopya doner (disaridan mutasyona kapali)", () => {
    const first = allDirections();
    first.push("N");
    expect(allDirections()).toHaveLength(8);
  });
});
