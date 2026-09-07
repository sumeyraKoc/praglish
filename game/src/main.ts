import Phaser from "phaser";
import { RoomScene } from "./scenes/RoomScene";
import { LibraryScene } from "./scenes/LibraryScene";
import { DubScene } from "./scenes/DubScene";

const game = new Phaser.Game({
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
  // sahneyi - LibraryScene'i - otomatik baslatir); "Sahneyi Seslendir"
  // butonu asagida elle scene.start("DubScene") cagirir.
  scene: [LibraryScene, RoomScene, DubScene],
});

// index.html'deki #dub-launcher butonu, normal oyun akisindan tamamen
// bagimsiz olan DubScene'e (bkz. o dosyanin basindaki mimari notu) her
// an gecis yapabilsin diye game nesnesi window'a bagliyoruz. Bu, projede
// "her ozellik kendi servisinde/sahnesinde" seklinde kurulan modulerlige
// dokunmadan en basit giris noktasi - ileride RoomScene ici bir menu
// dugmesine tasinabilir.
const runtimeWindow = window as typeof window & { praglishGame?: Phaser.Game };
runtimeWindow.praglishGame = game;

const dubLauncher = document.getElementById("dub-launcher");
dubLauncher?.addEventListener("click", () => {
  game.scene.start("DubScene");
});
