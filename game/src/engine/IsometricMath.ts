/**
 * Izometrik projeksiyon matematigi.
 *
 * Grid koordinatlari (gridX, gridY, gridZ - oda icindeki tam sayi tile pozisyonlari)
 * ile ekran koordinatlari (screenX, screenY - Phaser'in cizdigi piksel pozisyonlari)
 * arasinda donusum yapar.
 *
 * Bu dosya bilerek Phaser'a bagimli DEGIL - boylece tarayici/canvas olmadan,
 * saf Node.js ile test edilebilir. Habbo/baska hicbir motorun koduna bagimli
 * degil, standart izometrik projeksiyon formulu kullanir.
 */

export interface GridPosition {
  x: number;
  y: number;
  z: number; // kat/yukseklik (coğu oda icin 0)
}

export interface ScreenPosition {
  x: number;
  y: number;
}

export interface IsoConfig {
  tileWidth: number; // bir tile'in ekrandaki genisligi (piksel)
  tileHeight: number; // bir tile'in ekrandaki yuksekligi (piksel) - genelde tileWidth/2
  originX: number; // sahnedeki (0,0,0) grid noktasinin ekran X'i
  originY: number; // sahnedeki (0,0,0) grid noktasinin ekran Y'i
}

export const DEFAULT_ISO_CONFIG: IsoConfig = {
  tileWidth: 64,
  tileHeight: 32,
  originX: 0,
  originY: 0,
};

/** Grid pozisyonunu ekran pozisyonuna cevirir (standart 2:1 izometrik projeksiyon). */
export function gridToScreen(grid: GridPosition, config: IsoConfig = DEFAULT_ISO_CONFIG): ScreenPosition {
  const halfW = config.tileWidth / 2;
  const halfH = config.tileHeight / 2;
  return {
    x: config.originX + (grid.x - grid.y) * halfW,
    y: config.originY + (grid.x + grid.y) * halfH - grid.z * config.tileHeight,
  };
}

/** Ekran pozisyonunu (z=0 varsayarak) grid pozisyonuna geri cevirir - tiklanan yeri bulmak icin. */
export function screenToGrid(
  screen: ScreenPosition,
  config: IsoConfig = DEFAULT_ISO_CONFIG,
  subdivisions = 1,
): GridPosition {
  const halfW = config.tileWidth / 2;
  const halfH = config.tileHeight / 2;
  const relX = screen.x - config.originX;
  const relY = screen.y - config.originY;

  const gridX = (relX / halfW + relY / halfH) / 2;
  const gridY = (relY / halfH - relX / halfW) / 2;

  return {
    x: Math.round(gridX * subdivisions) / subdivisions,
    y: Math.round(gridY * subdivisions) / subdivisions,
    z: 0,
  };
}
