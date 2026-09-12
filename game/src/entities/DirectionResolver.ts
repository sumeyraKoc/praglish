
export type Direction8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export interface ResolvedDirection {
  direction: Direction8;
  spriteDirection: Direction8;
  flipX: boolean;
}

const DIRECTION_ORDER: Direction8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function vectorToDirection8(dx: number, dy: number): Direction8 {
  if (dx === 0 && dy === 0) return "S"; // default: face the camera

  const angle = Math.atan2(dy, dx); // -PI..PI, 0 = east (E)
  const index = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8; // always between 0 and 7
  const eastAligned: Direction8[] = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return eastAligned[index] as Direction8;
}

const MIRROR_MAP: Record<Direction8, { spriteDirection: Direction8; flipX: boolean }> = {
  N: { spriteDirection: "N", flipX: false },
  S: { spriteDirection: "S", flipX: false },
  E: { spriteDirection: "E", flipX: false },
  W: { spriteDirection: "E", flipX: true }, // mirror E to create W
  NE: { spriteDirection: "NE", flipX: false },
  NW: { spriteDirection: "NE", flipX: true }, // mirror NE to create NW
  SE: { spriteDirection: "SE", flipX: false },
  SW: { spriteDirection: "SE", flipX: true }, // mirror SE to create SW
};

export function resolveDirection(
  dx: number,
  dy: number,
  mode: "full8" | "mirror4"
): ResolvedDirection {
  const direction = vectorToDirection8(dx, dy);

  if (mode === "full8") {
    return { direction, spriteDirection: direction, flipX: false };
  }

  const mirrored = MIRROR_MAP[direction];
  return { direction, spriteDirection: mirrored.spriteDirection, flipX: mirrored.flipX };
}

export function allDirections(): Direction8[] {
  return [...DIRECTION_ORDER];
}
