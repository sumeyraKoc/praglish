import Phaser from "phaser";
import { RoomScene } from "./scenes/RoomScene";
import { LibraryScene } from "./scenes/LibraryScene";
import { DubScene } from "./scenes/DubScene";
import { StudioScene } from "./scenes/StudioScene";

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
  // DubScene listede olsa da otomatik BASLAMAZ (Phaser sadece dizideki ilk
  // sahneyi - LibraryScene'i - otomatik baslatir); StudioScene'e girisin
  // (LibraryScene/RoomScene'den "S" tusu, bkz. DomInputGuard.ts) ici, oradan
  // da "Sahneyi Seslendir" butonuyla DubScene'e geciliyor.
  scene: [LibraryScene, RoomScene, StudioScene, DubScene],
});
