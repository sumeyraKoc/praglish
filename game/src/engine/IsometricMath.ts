
export interface GridPosition {
  x: number;
  y: number;
  z: number; // floor/elevation (0 for most rooms)
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

export function gridToScreen(grid: GridPosition, config: IsoConfig = DEFAULT_ISO_CONFIG): ScreenPosition {
  const halfW = config.tileWidth / 2;
  const halfH = config.tileHeight / 2;
  return {
    x: config.originX + (grid.x - grid.y) * halfW,
    y: config.originY + (grid.x + grid.y) * halfH - grid.z * config.tileHeight,
  };
}

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
