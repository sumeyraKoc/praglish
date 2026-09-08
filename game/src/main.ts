import Phaser from "phaser";
import { RoomScene } from "./scenes/RoomScene";
import { LibraryScene } from "./scenes/LibraryScene";
import { DubScene } from "./scenes/DubScene";
import { StudioScene } from "./scenes/StudioScene";
import { MenuScene } from "./scenes/MenuScene";

new Phaser.Game({
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: "game",
  backgroundColor: "#181525",
  pixelArt: true,
  antialias: false,
  dom: {
    createContainer: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // Diger sahneler listede olsa da otomatik BASLAMAZ (Phaser sadece
  // dizideki ilk sahneyi - artik MenuScene'i - otomatik baslatir). Login/
  // signup akisi henuz yok; oyun su an dogrudan mod secim menusunden
  // basliyor. Menudeki "Oyna" butonlari LibraryScene/DubScene'i acar;
  // StudioScene'e eski yoldan da girilebilir (LibraryScene/RoomScene'den
  // "S" tusu, bkz. DomInputGuard.ts). Her sahneden "M" tusuyla menuye
  // donulebilir.
  scene: [MenuScene, LibraryScene, RoomScene, StudioScene, DubScene],
});
