
import { GridPosition } from "./IsometricMath";

const DEPTH_SCALE = 1000;

export function calculateDepth(grid: GridPosition): number {
  return (grid.x + grid.y) * DEPTH_SCALE + grid.z * DEPTH_SCALE * 2;
}

export function sortByDepth<T extends { grid: GridPosition }>(entities: T[]): T[] {
  return [...entities].sort((a, b) => calculateDepth(a.grid) - calculateDepth(b.grid));
}
