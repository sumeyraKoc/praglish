import { describe, expect, it } from "vitest";
import { allDirections, resolveDirection, vectorToDirection8 } from "../../entities/DirectionResolver";

describe("vectorToDirection8", () => {
  const cases: Array<[number, number, string]> = [
    [1, 0, "E"],
    [-1, 0, "W"],
    [0, -1, "N"],
    [0, 1, "S"],
    [1, 1, "SE"],
    [0, 0, "S"], // default to S while idle so the character faces the camera
  ];

  it.each(cases)("vectorToDirection8(%i, %i) -> %s", (dx, dy, expected) => {
    expect(vectorToDirection8(dx, dy)).toBe(expected);
  });
});

describe("resolveDirection", () => {
  it("mirror4 uses the flipped E sprite for W", () => {
    const west = resolveDirection(-1, 0, "mirror4");
    expect(west.spriteDirection).toBe("E");
    expect(west.flipX).toBe(true);
  });

  it("mirror4 keeps the original E sprite unflipped", () => {
    const east = resolveDirection(1, 0, "mirror4");
    expect(east.flipX).toBe(false);
  });

  it("full8 uses each direction's own sprite without flipping", () => {
    const nw8 = resolveDirection(-1, -1, "full8");
    expect(nw8.spriteDirection).toBe("NW");
    expect(nw8.flipX).toBe(false);
  });
});

describe("allDirections", () => {
  it("defines eight directions", () => {
    expect(allDirections()).toHaveLength(8);
  });

  it("returns a fresh copy on each call", () => {
    const first = allDirections();
    first.push("N");
    expect(allDirections()).toHaveLength(8);
  });
});
