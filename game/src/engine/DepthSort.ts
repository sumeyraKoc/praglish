/**
 * Izometrik bir odada, hangi objenin hangisinin ONUNDE cizilecegini belirler.
 * Standart kural: grid'de "arkada" (x+y kucuk) olan once cizilir, "onde" olan
 * (x+y buyuk) sonra cizilir ustune biner. z (kat/yukseklik) de buna eklenir.
 *
 * Bu tek bir sayi (depth) uretir, Phaser sprite.setDepth(depth) ile dogrudan kullanilir.
 */

import { GridPosition } from "./IsometricMath";

/**
 * Depth hesabinda x+y+z'yi buyuk bir carpanla olceklendiriyoruz ki ayni
 * (x+y) degerine sahip farkli z'lerin sirasi da bozulmasin, ve ondalikli
 * ofsetler (orn. yuruyen bir karakterin ara pozisyonlari) duzgun sıralansin.
 */
const DEPTH_SCALE = 1000;

export function calculateDepth(grid: GridPosition): number {
  return (grid.x + grid.y) * DEPTH_SCALE + grid.z * DEPTH_SCALE * 2;
}

/** Bir listeyi depth'e gore artan sirada dizer - test/debug icin kullanisli. */
export function sortByDepth<T extends { grid: GridPosition }>(entities: T[]): T[] {
  return [...entities].sort((a, b) => calculateDepth(a.grid) - calculateDepth(b.grid));
}
