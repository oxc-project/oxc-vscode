import { strictEqual } from "node:assert";
import { BiomeCommands } from "../../client/commands.js";

suite("commands", () => {
  test("command names are correct", () => {
    strictEqual(BiomeCommands.ShowOutput, "biome.showOutput");
    strictEqual(BiomeCommands.Restart, "biome.restart");
    strictEqual(BiomeCommands.ToggleEnabled, "biome.toggleEnabled");
    strictEqual(BiomeCommands.ApplyAllFixes, "biome.applyAllFixes");
    strictEqual(BiomeCommands.CopyDebugInfo, "biome.copyDebugInfo");
  });
});
