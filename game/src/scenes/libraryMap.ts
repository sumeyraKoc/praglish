export interface LibraryAsset {
  gid: number;
  key: string;
  file: string;
}

export interface LibraryTileLayer {
  type: "tilelayer";
  name: string;
  data: number[];
  offsetx?: number;
  offsety?: number;
}

interface LibraryObjectLayer {
  type: "objectgroup";
  name: string;
}

export interface LibraryMapData {
  width: number;
  height: number;
  layers: Array<LibraryTileLayer | LibraryObjectLayer>;
}

// Sample.tmj icindeki iki harici tileset'in yalnizca kullanilan GID'leri.
export const LIBRARY_ASSETS: LibraryAsset[] = [
  { gid: 16, key: "library-floor", file: "floor_E.png" },
  { gid: 50, key: "library-bookcase-glass", file: "bookcaseGlass_S.png" },
  { gid: 60, key: "library-bookcase-half", file: "bookcaseHalfWideBooks_E.png" },
  { gid: 68, key: "library-bookcase-wide", file: "bookcaseWideBooks_E.png" },
  { gid: 72, key: "library-bookcase-desk", file: "bookcaseWideBooksDesk_E.png" },
  { gid: 76, key: "library-bookcase-ladder", file: "bookcaseWideBooksLadder_E.png" },
  { gid: 90, key: "library-book-stand", file: "bookStand_S.png" },
  { gid: 94, key: "library-book-stand-empty", file: "bookStandEmpty_S.png" },
  { gid: 96, key: "library-candle", file: "candleStand_E.png" },
  { gid: 100, key: "library-candle-double-e", file: "candleStandDouble_E.png" },
  { gid: 101, key: "library-candle-double-n", file: "candleStandDouble_N.png" },
  { gid: 106, key: "library-display", file: "displayCase_S.png" },
  { gid: 110, key: "library-display-books", file: "displayCaseBooks_S.png" },
  { gid: 114, key: "library-display-open", file: "displayCaseOpen_S.png" },
  { gid: 118, key: "library-display-sword", file: "displayCaseSword_S.png" },
  { gid: 120, key: "library-carpet", file: "floorCarpet_E.png" },
  { gid: 124, key: "library-carpet-end-e", file: "floorCarpetEnd_E.png" },
  { gid: 127, key: "library-carpet-end-w", file: "floorCarpetEnd_W.png" },
  { gid: 140, key: "library-table", file: "longTableChairs_E.png" },
  { gid: 149, key: "library-table-decorated", file: "longTableDecoratedChairs_N.png" },
  { gid: 154, key: "library-table-books", file: "longTableDecoratedChairsBooks_S.png" },
  { gid: 160, key: "library-wall-books-e", file: "wallBooks_E.png" },
  { gid: 161, key: "library-wall-books-n", file: "wallBooks_N.png" },
  { gid: 164, key: "library-wall-door", file: "wallDoorway_E.png" },
];

/**
 * Hangi render/texture key'in hangi vocabulary "concept"ine karsilik geldigi.
 * Bircok farkli PNG (orn. candleStandDouble_E vs _N, ya da bes farkli bookcase
 * varyanti) ayni concept'e eslenebilir - concept string'leri
 * api/game_data/vocabulary/library.json ile birebir ayni olmali. Burada
 * olmayan key'ler (floor, wall-door, empty book stand) dekoratif kabul edilir
 * ve etkilesime acilmaz.
 */
export const ASSET_CONCEPT: Record<string, string> = {
  "library-bookcase-glass": "bookcase",
  "library-bookcase-half": "bookcase",
  "library-bookcase-wide": "bookcase",
  "library-bookcase-desk": "bookcase",
  "library-bookcase-ladder": "bookcase",
  "library-book-stand": "book",
  "library-candle": "candle",
  "library-candle-double-e": "candle",
  "library-candle-double-n": "candle",
  "library-display": "display_case",
  "library-display-books": "display_case",
  "library-display-open": "display_case",
  "library-display-sword": "display_case",
  "library-carpet": "carpet",
  "library-carpet-end-e": "carpet",
  "library-carpet-end-w": "carpet",
  "library-table": "table",
  "library-table-decorated": "chair",
  "library-table-books": "book",
  "library-wall-books-e": "bookcase",
  "library-wall-books-n": "bookcase",
};
