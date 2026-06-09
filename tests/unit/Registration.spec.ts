import { ok } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { BiomeCommands } from "../../client/commands.js";

suite("Registration", () => {
  test("all commands in package.json are defined in BiomeCommands enum", () => {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const contributedCommands = packageJson.contributes.commands.map((c: any) => c.command);

    const enumCommands = Object.values(BiomeCommands);

    for (const command of contributedCommands) {
      ok(enumCommands.includes(command), `Command "${command}" from package.json is missing in BiomeCommands enum`);
    }
  });

  test("BiomeCommands enum does not contain extra commands not in package.json", () => {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const contributedCommands = packageJson.contributes.commands.map((c: any) => c.command);

    const enumCommands = Object.values(BiomeCommands);

    for (const command of enumCommands) {
      ok(contributedCommands.includes(command), `Command "${command}" in BiomeCommands enum is not defined in package.json`);
    }
  });

  test("all commands in BiomeCommands enum are registered in extension.ts", () => {
    const extensionPath = path.resolve(process.cwd(), "client/extension.ts");
    const extensionContent = fs.readFileSync(extensionPath, "utf8");

    // We check for the usage of the enum member names in extension.ts
    const enumKeys = Object.keys(BiomeCommands).filter(key => isNaN(Number(key)));

    for (const key of enumKeys) {
      ok(extensionContent.includes(`BiomeCommands.${key}`), `Command BiomeCommands.${key} is not referenced in extension.ts for registration`);
    }
  });

  test("all contributed commands have corresponding onCommand activationEvents in package.json", () => {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const contributedCommands = packageJson.contributes.commands.map((c: any) => c.command);
    const activationEvents = packageJson.activationEvents || [];

    for (const command of contributedCommands) {
      const expectedEvent = `onCommand:${command}`;
      ok(activationEvents.includes(expectedEvent), `Missing activationEvent "${expectedEvent}" in package.json`);
    }
  });
});
