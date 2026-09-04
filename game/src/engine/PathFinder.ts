/**
 * Grid tabanli A* pathfinding. "Tikladigin yere yuru" mekanigi icin.
 * Koseleri kesmez: capraz hareket icin, capraza bitisik iki duz komsunun da
 * bos olmasi sartini arar (aksi halde karakter duvarin kosesinden gecer gibi gorunur).
 */

export interface GridCell {
  x: number;
  y: number;
}

export interface PathfindingGrid {
  width: number;
  height: number;
  isWalkable(x: number, y: number): boolean;
}

interface AStarNode {
  x: number;
  y: number;
  g: number; // baslangictan buraya maliyet
  h: number; // buradan hedefe tahmini maliyet (heuristic)
  f: number; // g + h
  parent: AStarNode | null;
}

const DIRECTIONS: Array<{ dx: number; dy: number; diagonal: boolean }> = [
  { dx: 0, dy: -1, diagonal: false },
  { dx: 0, dy: 1, diagonal: false },
  { dx: -1, dy: 0, diagonal: false },
  { dx: 1, dy: 0, diagonal: false },
  { dx: -1, dy: -1, diagonal: true },
  { dx: 1, dy: -1, diagonal: true },
  { dx: -1, dy: 1, diagonal: true },
  { dx: 1, dy: 1, diagonal: true },
];

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

export function findPath(
  grid: PathfindingGrid,
  start: GridCell,
  goal: GridCell
): GridCell[] | null {
  if (!grid.isWalkable(goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const open = new Map<string, AStarNode>();
  const closed = new Set<string>();

  const startNode: AStarNode = {
    x: start.x,
    y: start.y,
    g: 0,
    h: heuristic(start.x, start.y, goal.x, goal.y),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;
  open.set(key(start.x, start.y), startNode);

  const maxIterations = grid.width * grid.height * 4 + 100;
  let iterations = 0;

  while (open.size > 0) {
    iterations += 1;
    if (iterations > maxIterations) return null;

    let current: AStarNode | null = null;
    for (const node of open.values()) {
      if (!current || node.f < current.f) current = node;
    }
    if (!current) break;

    if (current.x === goal.x && current.y === goal.y) {
      const path: GridCell[] = [];
      let node: AStarNode | null = current;
      while (node) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      return path.slice(1);
    }

    open.delete(key(current.x, current.y));
    closed.add(key(current.x, current.y));

    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      if (closed.has(key(nx, ny))) continue;
      if (!grid.isWalkable(nx, ny)) continue;

      if (dir.diagonal) {
        const sideA = grid.isWalkable(current.x + dir.dx, current.y);
        const sideB = grid.isWalkable(current.x, current.y + dir.dy);
        if (!sideA || !sideB) continue;
      }

      const moveCost = dir.diagonal ? Math.SQRT2 : 1;
      const g = current.g + moveCost;
      const existing = open.get(key(nx, ny));

      if (!existing || g < existing.g) {
        const h = heuristic(nx, ny, goal.x, goal.y);
        open.set(key(nx, ny), { x: nx, y: ny, g, h, f: g + h, parent: current });
      }
    }
  }

  return null;
}
