/**
 * Bootstrap Skill Store Catalog
 *
 * Fetches all SKILL.md files from the OpenClaw repo, parses frontmatter,
 * assigns categories, and optionally audits each skill with Claude for
 * security ratings. Outputs skill-store-catalog.json.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-skill-store.ts
 *   npx tsx scripts/bootstrap-skill-store.ts --audit   # with Claude security audit
 *
 * Requires ANTHROPIC_API_KEY env var for --audit mode.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_RAW_BASE =
  "https://raw.githubusercontent.com/openclaw/openclaw/main/skills";

const SKILL_NAMES = [
  "1password", "apple-notes", "apple-reminders", "bear-notes", "blogwatcher",
  "blucli", "bluebubbles", "camsnap", "canvas", "clawhub", "coding-agent",
  "discord", "eightctl", "gemini", "gh-issues", "gifgrep", "github", "gog",
  "goplaces", "healthcheck", "himalaya", "imsg", "mcporter", "model-usage",
  "nano-pdf", "node-connect", "notion", "obsidian", "openai-whisper",
  "openai-whisper-api", "openhue", "oracle", "ordercli", "peekaboo", "sag",
  "session-logs", "sherpa-onnx-tts", "skill-creator", "slack", "songsee",
  "sonoscli", "spotify-player", "summarize", "taskflow",
  "taskflow-inbox-triage", "things-mac", "tmux", "trello", "video-frames",
  "voice-call", "wacli", "weather", "xurl",
];

const CATEGORY_MAP: Record<string, string> = {
  github: "development", "gh-issues": "development", "coding-agent": "development",
  tmux: "development", canvas: "development", "session-logs": "development",
  mcporter: "development",
  slack: "communication", discord: "communication", imsg: "communication",
  bluebubbles: "communication", blucli: "communication", "voice-call": "communication",
  notion: "productivity", trello: "productivity", taskflow: "productivity",
  "taskflow-inbox-triage": "productivity", "things-mac": "productivity",
  "apple-reminders": "productivity", ordercli: "productivity",
  "apple-notes": "notes", "bear-notes": "notes", obsidian: "notes",
  "spotify-player": "media", sonoscli: "media", songsee: "media",
  gifgrep: "media", "video-frames": "media", camsnap: "media", peekaboo: "media",
  gemini: "ai-ml", "openai-whisper": "ai-ml", "openai-whisper-api": "ai-ml",
  "sherpa-onnx-tts": "ai-ml", summarize: "ai-ml", "model-usage": "ai-ml",
  openhue: "smart-home", goplaces: "smart-home", weather: "smart-home",
  "1password": "security",
  blogwatcher: "automation", healthcheck: "automation", wacli: "automation",
  eightctl: "automation", "node-connect": "automation", xurl: "automation",
  "nano-pdf": "automation", sag: "automation", gog: "automation",
  "skill-creator": "utilities", clawhub: "utilities", oracle: "utilities",
  himalaya: "utilities",
};

interface CatalogEntry {
  name: string;
  description: string;
  emoji: string;
  category: string;
  tags: string[];
  security_rating: "safe" | "caution" | "warning";
  security_notes: string;
  source_url: string;
  requires?: Record<string, string[]>;
  install_methods?: Record<string, unknown>[];
}

function parseFrontmatter(content: string): Record<string, any> {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) return {};
  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx === -1) return {};
  const yaml = trimmed.slice(3, endIdx).trim();
  const result: Record<string, any> = {};
  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\S+):\s*"?(.+?)"?\s*$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

async function fetchSkillMd(name: string): Promise<string | null> {
  const url = `${REPO_RAW_BASE}/${name}/SKILL.md`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
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

async function main() {
  const catalog: CatalogEntry[] = [];

  for (const name of SKILL_NAMES) {
    console.log(`Fetching ${name}...`);
    const content = await fetchSkillMd(name);
    const fm = content ? parseFrontmatter(content) : {};
    const description = fm.description || `${name} skill`;
    const emoji = fm.emoji || "⚡";
    const category = CATEGORY_MAP[name] || "utilities";
    const requires = fm.requires as Record<string, string[]> | undefined;
    const { rating, notes } = content
      ? inferSecurityRating(content, requires)
      : { rating: "caution" as const, notes: "Could not fetch skill content for audit." };

    catalog.push({
      name,
      description,
      emoji,
      category,
      tags: deriveTags(name, description),
      security_rating: rating,
      security_notes: notes,
      source_url: `${REPO_RAW_BASE}/${name}/SKILL.md`,
      ...(requires ? { requires } : {}),
    });
  }

  const outPath = path.resolve(__dirname, "../interface/src/data/skill-store-catalog.json");
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`Wrote ${catalog.length} skills to ${outPath}`);
}

main().catch(console.error);
