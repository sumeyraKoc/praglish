export interface BakeryAsset {
  key: string;
  file: string;
}

export interface TileLayer {
  type: "tilelayer";
  name: string;
  data: number[];
  offsetx?: number;
  offsety?: number;
}

interface OtherLayer {
  type: "objectgroup";
  name: string;
}

export interface BakeryMapData {
  width: number;
  height: number;
  layers: Array<TileLayer | OtherLayer>;
  tilesets: Array<{ tiles: Array<{ id: number; image: string }> }>;
}

export const BAKERY_ASSETS: BakeryAsset[] = [
  { key: "floor", file: "Asset_Building_Floor_Alt4.png" },
  { key: "pillar", file: "Asset_Building_Pillar_Alt1.png" },
  { key: "wall", file: "Asset_Building_Wall_Alt2.png" },
  { key: "cake-shelf", file: "Asset_Decoration_Bakery_Cake shelf.png" },
  { key: "bread-bucket", file: "Asset_Decoration_Bread_Bucket.png" },
  { key: "bread-shelf", file: "Asset_Decoration_Bread_Shelf.png" },
  { key: "light", file: "Asset_Decoration_Light_Alt2.png" },
  { key: "sale-poster", file: "Asset_Decoration_Poster_Sale.png" },
  { key: "cashier", file: "Asset_Decoration_Shop_Cashier.png" },
  { key: "counter", file: "Asset_Decoration_Shop_Counter.png" },
  { key: "tall-shelf", file: "Asset_Decoration_Tall_Shelf_Alt1.png" },
  { key: "teddy", file: "Asset_Decoration_Teddy_Alt1.png" },
  { key: "tray-1", file: "Asset_Decoration_Tray_Alt1.png" },
  { key: "tray-2", file: "Asset_Decoration_Tray_Alt2.png" },
  { key: "plant", file: "Asset_Decoration_Tree_Pot_Alt1.png" },
  { key: "bakery-counter", file: "Bakery_Counter_Full.png" },
  { key: "display-counter", file: "Bread_Display_Counter.png" },
  { key: "character-gif", file: "Character.gif" },
  { key: "character-sheet", file: "Character-Sheet.png" },
  { key: "cake-case-full", file: "Dolu_Pasta_Dolabi.png" },
  { key: "footmat", file: "Footmat.png" },
  { key: "cash-register", file: "kasa_full.png" },
  { key: "meat-pie", file: "Meat_Pie.png" },
  { key: "cake-case", file: "olu_Pasta_Dolabi.png" },
  { key: "bread", file: "Pixal Art-Asset_Bread_Alt2.png" },
  { key: "cookie", file: "Pixal Art-Asset_Cookie_Alt1.png" },
  { key: "croissant", file: "Pixal Art-Asset_Food_croissant_Alt1.png" },
  { key: "cake", file: "Pixal Art-Asset_Food-Cake.png" },
  { key: "egg-tart", file: "Pixal Art-Asset_Food-Egg_Tart.png" },
];

/**
 * Hangi render/texture key'in hangi vocabulary "concept"ine karsilik geldigi.
 * Bircok farkli PNG (farkli yon, farkli varyant) ayni concept'e eslenebilir -
 * concept string'leri api/game_data/vocabulary/bakery.json ile birebir ayni
 * olmali. Burada olmayan key'ler (floor, wall, pillar, light, sale-poster,
 * teddy, footmat, character-*) dekoratif kabul edilir ve etkilesime acilmaz.
 */
export const ASSET_CONCEPT: Record<string, string> = {
  "cake-shelf": "cake",
  "bread-bucket": "bread",
  "bread-shelf": "bread",
  "cashier": "cash_register",
  "counter": "counter",
  "tall-shelf": "shelf",
  "tray-1": "tray",
  "tray-2": "tray",
  "plant": "plant",
  "bakery-counter": "counter",
  "display-counter": "counter",
  "cake-case-full": "cake",
  "cash-register": "cash_register",
  "meat-pie": "pie",
  "cake-case": "cake",
  "bread": "bread",
  "cookie": "cookie",
  "croissant": "croissant",
  "cake": "cake",
  "egg-tart": "egg_tart",
};
