import Phaser from "phaser";
import { RoomScene } from "./scenes/RoomScene";
import { LibraryScene } from "./scenes/LibraryScene";

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
  scene: [LibraryScene, RoomScene],
});
