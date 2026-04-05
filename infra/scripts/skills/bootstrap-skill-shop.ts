/**
 * Bootstrap Skill Shop Catalog
 *
 * Reads all local SKILL.md files from skills/{category}/{name}/ directories,
 * parses frontmatter, assigns categories, and generates skill-shop-catalog.json.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-skill-shop.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SKILLS_DIR = path.resolve(__dirname, "../skills");
const OUTPUT_PATH = path.resolve(
  __dirname,
  "../interface/src/data/skill-shop-catalog.json",
);

const REPO_RAW_BASE =
  "https://raw.githubusercontent.com/openclaw/openclaw/main/skills";

const MAC_ONLY = new Set([
  "apple-notes", "apple-reminders", "bear-notes", "things-mac",
  "imsg", "bluebubbles", "blucli", "camsnap", "peekaboo", "sonoscli", "model-usage",
]);
const WINDOWS_ONLY = new Set(["obsidian"]);
const LINUX_ONLY = new Set(["tmux"]);

interface SkillPermissions {
  paths?: string[];
  commands?: string[];
  tools?: string[];
}

interface CatalogEntry {
  name: string;
  description: string;
  emoji: string | null;
  category: string;
  os: string;
  tags: string[];
  security_rating: "safe" | "caution" | "warning";
  security_notes: string;
  source_url: string;
  requires?: Record<string, string[]>;
  install_methods?: Record<string, unknown>[];
  permissions?: SkillPermissions;
}

function parseYamlArray(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

function parseFrontmatter(content: string): Record<string, any> {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) return {};
  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx === -1) return {};
  const yaml = trimmed.slice(3, endIdx).trim();
  const result: Record<string, any> = {};
  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\S+):\s*(.+?)\s*$/);
    if (!match) continue;
    const [, key, rawVal] = match;
    const arr = parseYamlArray(rawVal);
    result[key] = arr !== null ? arr : rawVal.replace(/^"(.*)"$/, "$1");
  }
  return result;
}

function deriveTags(name: string, description: string): string[] {
  const tags = name.split("-").filter((t) => t.length > 2);
  const words = description.toLowerCase().split(/\s+/).slice(0, 20);
  const keywords = ["api", "cli", "bot", "iot", "ai", "ml", "tts", "pdf"];
  for (const kw of keywords) {
    if (words.some((w) => w.includes(kw)) && !tags.includes(kw)) tags.push(kw);
  }
  return tags.slice(0, 5);
}

function inferSecurityRating(
  content: string,
  requires: Record<string, string[]> | undefined,
): { rating: "safe" | "caution" | "warning"; notes: string } {
  const lower = content.toLowerCase();
  if (lower.includes("arbitrary") || lower.includes("sudo") || lower.includes("rm -rf")) {
    return { rating: "warning", notes: "Skill may execute broad system commands." };
  }
  if (requires?.env?.length) {
    return { rating: "caution", notes: `Requires environment credentials: ${requires.env.join(", ")}.` };
  }
  if (lower.includes("shell") || lower.includes("exec") || lower.includes("bash")) {
    return { rating: "caution", notes: "Skill executes shell commands for its operations." };
  }
  return { rating: "safe", notes: "Skill operates within its tool's standard scope." };
}

function determineOS(name: string): string {
  if (MAC_ONLY.has(name)) return "mac";
  if (WINDOWS_ONLY.has(name)) return "windows";
  if (LINUX_ONLY.has(name)) return "linux";
  return "any";
}

function main() {
  const catalog: CatalogEntry[] = [];

  const categories = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const category of categories) {
    const categoryDir = path.join(SKILLS_DIR, category);
    const skills = fs.readdirSync(categoryDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const name of skills) {
      const skillPath = path.join(categoryDir, name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      const content = fs.readFileSync(skillPath, "utf-8");
      const fm = parseFrontmatter(content);
      const description = fm.description || `${name} skill`;
      const emoji = fm.emoji || null;
      const requires = fm.requires as Record<string, string[]> | undefined;
      const { rating, notes } = inferSecurityRating(content, requires);

      const permPaths = (fm["allowed-paths"] ?? fm["allowed_paths"]) as string[] | undefined;
      const permCommands = (fm["allowed-commands"] ?? fm["allowed_commands"]) as string[] | undefined;
      const permTools = (fm["allowed-tools"] ?? fm["allowed_tools"]) as string[] | undefined;
      const hasPerms =
        (permPaths && permPaths.length > 0) ||
        (permCommands && permCommands.length > 0) ||
        (permTools && permTools.length > 0);
      const permissions: SkillPermissions | undefined = hasPerms
        ? {
            ...(permPaths?.length ? { paths: permPaths } : {}),
            ...(permCommands?.length ? { commands: permCommands } : {}),
            ...(permTools?.length ? { tools: permTools } : {}),
          }
        : undefined;

      catalog.push({
        name,
        description,
        emoji,
        category,
        os: determineOS(name),
        tags: deriveTags(name, description),
        security_rating: rating,
        security_notes: notes,
        source_url: `${REPO_RAW_BASE}/${name}/SKILL.md`,
        ...(requires ? { requires } : {}),
        ...(permissions ? { permissions } : {}),
      });
    }
  }

  catalog.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`Wrote ${catalog.length} skills to ${OUTPUT_PATH}`);
}

main();
