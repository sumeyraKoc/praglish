import Phaser from "phaser";
import { RoomScene } from "./scenes/RoomScene";
import { LibraryScene } from "./scenes/LibraryScene";
import { DubScene } from "./scenes/DubScene";
import { DashboardScene } from "./scenes/DashboardScene";
import { MenuScene } from "./scenes/MenuScene";

new Phaser.Game({
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: "game",
  backgroundColor: "#181525",
  // Listen & Repeat'in seviye secimi ve seslendirme ekranlarinda tarayici
  // arka planindaki gorsellerin FIT canvas'in disinda da gorunebilmesi icin
  // canvas alfa destekli. Diger sahneler kendi opak kamera arka planlarini
  // zaten ayarliyor; dolayisiyla bu yalnizca DubScene tarafindan kullaniliyor.
  transparent: true,
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
  // basliyor. Menudeki "Oyna" butonlari LibraryScene/DubScene'i acar.
  // Listen & Repeat'e yalnizca ana menuden girilir.
  scene: [MenuScene, LibraryScene, RoomScene, DubScene, DashboardScene],
});
