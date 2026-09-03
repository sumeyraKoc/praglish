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
    console.log(`FAIL: ${label}\n  beklenen: ${JSON.stringify(expected)}\n  gelen:    ${JSON.stringify(actual)}`);
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

// --- IsometricMath ---
// (0,0,0) her zaman origin'e denk gelmeli
assertEqual(gridToScreen({ x: 0, y: 0, z: 0 }), { x: 0, y: 0 }, "grid (0,0) -> screen origin");

// grid<->screen donusumu tersine cevrilebilir olmali (round-trip)
const someGrid = { x: 3, y: 5, z: 0 };
const screen = gridToScreen(someGrid, DEFAULT_ISO_CONFIG);
const backToGrid = screenToGrid(screen, DEFAULT_ISO_CONFIG);
assertEqual(backToGrid, someGrid, "grid -> screen -> grid round-trip (3,5)");

const halfTile = screenToGrid({ x: 16, y: 8 }, DEFAULT_ISO_CONFIG, 2);
assertEqual(halfTile, { x: 0.5, y: 0, z: 0 }, "screen -> grid yarim-karo hassasiyeti");

// --- DepthSort ---
// Grid'de "onde" olan (x+y buyuk) daha yuksek depth almali (sonra cizilir, ustte gorunur)
const front = calculateDepth({ x: 5, y: 5, z: 0 });
const back = calculateDepth({ x: 1, y: 1, z: 0 });
assertTrue(front > back, "onde olan entity daha yuksek depth alir");

// Ayni x+y'de daha yuksek z (daha yukarida duran, orn. rafin ustundeki esya) daha ustte cizilmeli
const higher = calculateDepth({ x: 2, y: 2, z: 1 });
const lower = calculateDepth({ x: 2, y: 2, z: 0 });
assertTrue(higher > lower, "ayni tile'da daha yuksek z daha ustte cizilir");

// --- PathFinder ---
// Basit 5x5 bos grid - duz cizgi yeterli olmali
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
assertTrue(straightPath !== null && straightPath.length === 4, "bos grid'de duz yol bulunur (4 adim)");

// KOSE KESME TESTI: L-seklinde bir engel var, capraz gitmek icin kosesinden
// gecmesi GEREKMEYEN ama capraz komsulari bloklu bir durum kuruyoruz.
// (1,0) ve (0,1) blok -> (0,0)'dan (1,1)'e capraz gitmek kose kesmek olur, YASAK olmali.
const cornerBlocked = makeGrid(3, 3, new Set(["1,0", "0,1"]));
const cornerPath = findPath(cornerBlocked, { x: 0, y: 0 }, { x: 1, y: 1 });
// Dogrudan capraz adim YOK sayilmali (kose kesme onlendigi icin), ama dolasarak
// hala imkansiz olmali cunku (1,0) ve (0,1) tek gecis noktalari - bu durumda null donmeli.
assertTrue(cornerPath === null, "iki yani da blok olan capraz hedefe ulasilamaz (kose kesme engellendi)");

// Ama sadece TEK bir yani blok olan capraz hareket YASAK olmamali (gercek oyunlarda cok sik olur)
const oneSideBlocked = makeGrid(3, 3, new Set(["1,0"])); // sadece bir yan blok
const oneSidePath = findPath(oneSideBlocked, { x: 0, y: 0 }, { x: 1, y: 1 });
assertTrue(oneSidePath !== null, "sadece tek yani blok olan caprazda alternatif yol bulunur");

// Hic ulasilamayan hedef (tamamen cevrili)
const surrounded = makeGrid(3, 3, new Set(["0,1", "1,0", "1,1"]));
const noPath = findPath(surrounded, { x: 0, y: 0 }, { x: 2, y: 2 });
assertTrue(noPath === null, "tamamen cevrili hedefe yol bulunamaz (null doner)");

// --- DirectionResolver ---
assertEqual(vectorToDirection8(1, 0), "E", "sag hareket -> E");
assertEqual(vectorToDirection8(-1, 0), "W", "sol hareket -> W");
assertEqual(vectorToDirection8(0, -1), "N", "yukari hareket -> N");
assertEqual(vectorToDirection8(0, 1), "S", "asagi hareket -> S");
assertEqual(vectorToDirection8(1, 1), "SE", "sag-asagi capraz -> SE");
assertEqual(vectorToDirection8(0, 0), "S", "hareketsizken varsayilan S");

// mirror4 modu: W, E'nin flipX'li hali olmali (aynanin dogru calistigi kritik test)
const west = resolveDirection(-1, 0, "mirror4");
assertEqual(west.spriteDirection, "E", "mirror4: W yonu, E sprite'ini flip ile kullanir");
assertTrue(west.flipX === true, "mirror4: W yonunde flipX true olmali");

const east = resolveDirection(1, 0, "mirror4");
assertTrue(east.flipX === false, "mirror4: E yonunde flipX false olmali (orijinal sprite)");

// full8 modunda hic flip olmamali, her yon kendi sprite'ini kullanir
const nw8 = resolveDirection(-1, -1, "full8");
assertEqual(nw8.spriteDirection, "NW", "full8: NW kendi sprite'ini kullanir");
assertTrue(nw8.flipX === false, "full8 modunda hic flip kullanilmaz");

assertEqual(allDirections().length, 8, "toplam 8 yon tanimli");

console.log(`\n${passed} test gecti, ${failed} test basarisiz.`);
if (failed > 0) process.exit(1);
