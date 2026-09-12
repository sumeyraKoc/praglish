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
  scene: [MenuScene, LibraryScene, RoomScene, DubScene, DashboardScene],
});
