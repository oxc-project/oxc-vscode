#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PackageJson {
  contributes: {
    configuration: {
      properties: Record<string, ConfigProperty>;
    };
  };
}

interface ConfigProperty {
  scope?: "window" | "resource";
  deprecated?: boolean;
  default?: unknown;
  markdownDescription?: string;
  description?: string;
  enum?: string[];
  type?: string | string[];
}

interface ConfigRow {
  key: string;
  defaultValue: string;
  possibleValues: string;
  description: string;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error("Usage: pnpm run docs:update");
    process.exit(1);
  }

  const command = args[0];

  if (command === "update") {
    updateReadme();
  } else {
    console.error(`Unknown command: ${command}. Use 'update'`);
    process.exit(1);
  }
}

function updateReadme(): void {
  const generatedContent = generateConfigurationDocs();
  const readmePath = getReadmePath();
  const readmeContent = readFileSync(readmePath, "utf-8");

  const updatedContent = replaceGeneratedSection(readmeContent, generatedContent);

  writeFileSync(readmePath, updatedContent);

  console.log("✅ README.md updated successfully!");
}

function getReadmePath(): string {
  return join(__dirname, "..", "README.md");
}

function getPackageJsonPath(): string {
  return join(__dirname, "..", "package.json");
}

function replaceGeneratedSection(readme: string, generated: string): string {
  const START_MARKER = "<!-- START_GENERATED_CONFIGURATION -->";
  const END_MARKER = "<!-- END_GENERATED_CONFIGURATION -->";

  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = readme.substring(0, startIdx + START_MARKER.length);
    const after = readme.substring(endIdx);
    return `${before}\n${generated}\n${after}`;
  }

  // If markers don't exist, return original content
  return readme;
}

function generateConfigurationDocs(): string {
  const packageJsonPath = getPackageJsonPath();
  const packageJsonContent = readFileSync(packageJsonPath, "utf-8");
  const packageJson: PackageJson = JSON.parse(packageJsonContent);

  const windowConfigs: ConfigRow[] = [];
  const windowDeprecatedConfigs: ConfigRow[] = [];
  const workspaceConfigs: ConfigRow[] = [];
  const workspaceDeprecatedConfigs: ConfigRow[] = [];

  // Sort properties by key for consistent output
  const properties = Object.entries(packageJson.contributes.configuration.properties).sort(
    ([a], [b]) => a.localeCompare(b),
  );

  for (const [key, value] of properties) {
    const scope = value.scope ?? "resource";
    const isDeprecated = value.deprecated ?? false;

    const defaultValue = formatDefaultValue(value.default);
    const description = value.markdownDescription ?? value.description ?? "";
    const possibleValues = getPossibleValues(value);

    const row: ConfigRow = {
      key,
      defaultValue,
      possibleValues,
      description,
    };

    if (scope === "window") {
      if (isDeprecated) {
        windowDeprecatedConfigs.push(row);
      } else {
        windowConfigs.push(row);
      }
    } else {
      if (isDeprecated) {
        workspaceDeprecatedConfigs.push(row);
      } else {
        workspaceConfigs.push(row);
      }
    }
  }

  let output = "";

  output += "\n### Window Configuration\n\n";
  output +=
    "Following configurations are supported via `settings.json` and affect the window editor:\n\n";
  output += generateTable(windowConfigs, windowDeprecatedConfigs);

  output += "\n### Workspace Configuration\n\n";
  output +=
    "Following configurations are supported via `settings.json` and can be changed for each workspace:\n\n";
  output += generateTable(workspaceConfigs, workspaceDeprecatedConfigs);

  // Add FixKind section if there are any references to it
  const hasFixKindRef = workspaceConfigs.some(
    (c) => c.key === "oxc.fixKind" || c.description.toLowerCase().includes("fixkind"),
  );

  if (hasFixKindRef) {
    output += "\n#### FixKind\n\n";
    output += '- `"safe_fix"` (default)\n';
    output += '- `"safe_fix_or_suggestion"`\n';
    output += '- `"dangerous_fix"`\n';
    output += '- `"dangerous_fix_or_suggestion"`\n';
    output += '- `"none"`\n';
    output += '- `"all"`\n';
  }

  return output;
}

function generateTable(configs: ConfigRow[], deprecatedConfigs: ConfigRow[]): string {
  let output = "";

  output += "| Key | Default Value | Possible Values | Description |\n";
  output += "| --- | ------------- | --------------- | ----------- |\n";

  for (const config of configs) {
    const key = `\`${config.key}\``;
    const defaultValue = config.defaultValue;
    const possibleValues = config.possibleValues;
    const description = cleanMarkdownForTable(config.description);

    output += `| ${key} | ${defaultValue} | ${possibleValues} | ${description} |\n`;
  }

  // Add deprecated configs if any with empty row separator
  if (deprecatedConfigs.length > 0) {
    // Add empty row in the table
    output += "| Deprecated | | | |\n";

    for (const config of deprecatedConfigs) {
      const key = `\`${config.key}\``;
      const defaultValue = config.defaultValue;
      const possibleValues = config.possibleValues;
      const description = cleanMarkdownForTable(config.description);

      output += `| ${key} | ${defaultValue} | ${possibleValues} | ${description} |\n`;
    }
  }

  return output;
}

function formatDefaultValue(value: unknown): string {
  if (value === null) {
    return "`null`";
  }
  if (typeof value === "boolean") {
    return `\`${value}\``;
  }
  if (typeof value === "string") {
    return `\`${value}\``;
  }
  if (typeof value === "number") {
    return `\`${value}\``;
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return "`[]`";
    }
    return "`{}`";
  }
  return "-";
}

function getTypeString(type: string | string[]): string {
  if (!type) {
    return "-";
  }
  if (type === "boolean") {
    return "`true` \\| `false`";
  }
  if (type === "string") {
    return "`<string>`";
  }
  if (type === "number") {
    return "`<number>`";
  }
  if (type === "object") {
    return "`Record<string, string>`";
  }
  if (Array.isArray(type)) {
    return type.map((t) => getTypeString(t)).join(" \\| ");
  }

  return `\`<${type}>\``;
}

function getPossibleValues(value: ConfigProperty): string {
  if (value.enum && Array.isArray(value.enum)) {
    return value.enum.map((v) => `\`${v}\``).join(" \\| ");
  }

  if (value.type) {
    return getTypeString(value.type);
  }

  return "-";
}

function cleanMarkdownForTable(text: string): string {
  // Remove newlines and extra spaces
  return text
    .split("\n")
    .map((line) => line.trim())
    .join(" ")
    .trim();
}

main();
