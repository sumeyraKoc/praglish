import { defineConfig } from "vitest/config";

// Oyun motorunun saf mantigini (izometrik matematik, derinlik siralamasi,
// pathfinding, yon cozumleme) Phaser/canvas'a hic ihtiyac duymadan test eder.
// Bu yuzden environment "node" yeterli - jsdom gerekmiyor.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
