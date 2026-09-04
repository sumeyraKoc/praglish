/**
 * Hareket vektorunden (dx, dy) hangi yone bakilacagini ve o yon icin hangi
 * animasyon karesinin/mirror'un kullanilacagini cozer.
 *
 * Iki modu destekler:
 *  - "full8": asset paketinde 8 yonun hepsi ayri ayri cizilmis (orn. AxulArt paketi gibi)
 *  - "mirror4": sadece 4 yon cizilmis (N/S/E/W), capraz yonler en yakin yatay/dikey
 *    yonun mirror'u (yatay flip) ile taklit edilir. Bircok profesyonel 2D izometrik
 *    oyun bunu kullanir - sanat maliyetini yariya indirir.
 */

export type Direction8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export interface ResolvedDirection {
  direction: Direction8;
  /** mirror4 modunda hangi cizilmis yonun kullanilacagi (full8'de direction ile ayni) */
  spriteDirection: Direction8;
  /** true ise sprite yatay olarak ters cevrilmeli (flipX) */
  flipX: boolean;
}

const DIRECTION_ORDER: Direction8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** dx/dy hareket vektorunu 8 yonden birine yuvarlar. */
export function vectorToDirection8(dx: number, dy: number): Direction8 {
  if (dx === 0 && dy === 0) return "S"; // varsayilan: kameraya bakar

  const angle = Math.atan2(dy, dx); // -PI..PI, 0 = dogu (E)
  const index = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8; // her zaman 0..7 araliginda
  // atan2 dogu=0 baz alir, DIRECTION_ORDER'i buna gore hizala:
  const eastAligned: Direction8[] = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return eastAligned[index] as Direction8;
}

const MIRROR_MAP: Record<Direction8, { spriteDirection: Direction8; flipX: boolean }> = {
  N: { spriteDirection: "N", flipX: false },
  S: { spriteDirection: "S", flipX: false },
  E: { spriteDirection: "E", flipX: false },
  W: { spriteDirection: "E", flipX: true }, // E'nin aynasi = W
  NE: { spriteDirection: "NE", flipX: false },
  NW: { spriteDirection: "NE", flipX: true }, // NE'nin aynasi = NW
  SE: { spriteDirection: "SE", flipX: false },
  SW: { spriteDirection: "SE", flipX: true }, // SE'nin aynasi = SW
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
