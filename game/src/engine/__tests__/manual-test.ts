import { gridToScreen, screenToGrid, DEFAULT_ISO_CONFIG } from "../IsometricMath";
import { calculateDepth, sortByDepth } from "../DepthSort";
import { findPath, PathfindingGrid } from "../PathFinder";
import { vectorToDirection8, resolveDirection, allDirections } from "../../entities/DirectionResolver";

let passed = 0;
let failed = 0;

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  received: ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, label: string) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL: ${label}`);
  }
}

assertEqual(gridToScreen({ x: 0, y: 0, z: 0 }), { x: 0, y: 0 }, "grid (0,0) -> screen origin");

const someGrid = { x: 3, y: 5, z: 0 };
const screen = gridToScreen(someGrid, DEFAULT_ISO_CONFIG);
const backToGrid = screenToGrid(screen, DEFAULT_ISO_CONFIG);
assertEqual(backToGrid, someGrid, "grid -> screen -> grid round-trip (3,5)");

const halfTile = screenToGrid({ x: 16, y: 8 }, DEFAULT_ISO_CONFIG, 2);
assertEqual(halfTile, { x: 0.5, y: 0, z: 0 }, "screen -> grid half-tile precision");

// --- DepthSort ---
const front = calculateDepth({ x: 5, y: 5, z: 0 });
const back = calculateDepth({ x: 1, y: 1, z: 0 });
assertTrue(front > back, "the entity farther forward receives a higher depth");

const higher = calculateDepth({ x: 2, y: 2, z: 1 });
const lower = calculateDepth({ x: 2, y: 2, z: 0 });
assertTrue(higher > lower, "a higher z value is drawn above another entity on the same tile");

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

const emptyGrid = makeGrid(5, 5, new Set());
const straightPath = findPath(emptyGrid, { x: 0, y: 0 }, { x: 4, y: 0 });
assertTrue(straightPath !== null && straightPath.length === 4, "finds a straight four-step path on an empty grid");

const cornerBlocked = makeGrid(3, 3, new Set(["1,0", "0,1"]));
const cornerPath = findPath(cornerBlocked, { x: 0, y: 0 }, { x: 1, y: 1 });
assertTrue(cornerPath === null, "cannot reach a diagonal destination when both sides are blocked");

const oneSideBlocked = makeGrid(3, 3, new Set(["1,0"])); // only one adjacent side is blocked
const oneSidePath = findPath(oneSideBlocked, { x: 0, y: 0 }, { x: 1, y: 1 });
assertTrue(oneSidePath !== null, "finds an alternative diagonal path when only one side is blocked");

const surrounded = makeGrid(3, 3, new Set(["0,1", "1,0", "1,1"]));
const noPath = findPath(surrounded, { x: 0, y: 0 }, { x: 2, y: 2 });
assertTrue(noPath === null, "returns null for a fully enclosed destination");

assertEqual(vectorToDirection8(1, 0), "E", "right movement -> E");
assertEqual(vectorToDirection8(-1, 0), "W", "left movement -> W");
assertEqual(vectorToDirection8(0, -1), "N", "upward movement -> N");
assertEqual(vectorToDirection8(0, 1), "S", "downward movement -> S");
assertEqual(vectorToDirection8(1, 1), "SE", "down-right diagonal -> SE");
assertEqual(vectorToDirection8(0, 0), "S", "default idle direction is S");

const west = resolveDirection(-1, 0, "mirror4");
assertEqual(west.spriteDirection, "E", "mirror4 uses the flipped E sprite for W");
assertTrue(west.flipX === true, "mirror4 sets flipX for W");

const east = resolveDirection(1, 0, "mirror4");
assertTrue(east.flipX === false, "mirror4 keeps the original E sprite unflipped");

const nw8 = resolveDirection(-1, -1, "full8");
assertEqual(nw8.spriteDirection, "NW", "full8 uses the NW sprite for NW");
assertTrue(nw8.flipX === false, "full8 never flips sprites");

assertEqual(allDirections().length, 8, "defines eight directions");

console.log(`\n${passed} tests passed, ${failed} tests failed.`);
if (failed > 0) process.exit(1);
