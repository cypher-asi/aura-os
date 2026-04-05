/**
 * Pull Skills — download all SKILL.md files from GitHub into local skills/ folder.
 *
 * Reads skill-shop-catalog.json for names, categories, and source_url values,
 * fetches each SKILL.md, and writes to skills/{category}/{name}/SKILL.md.
 *
 * Usage:
 *   npx tsx scripts/pull-skills.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface CatalogEntry {
  name: string;
  category: string;
  source_url: string;
}

const CATALOG_PATH = path.resolve(
  __dirname,
  "../interface/src/data/skill-shop-catalog.json",
);
const SKILLS_DIR = path.resolve(__dirname, "../skills");

async function main() {
  const raw = fs.readFileSync(CATALOG_PATH, "utf-8");
  const catalog: CatalogEntry[] = JSON.parse(raw);

  let succeeded = 0;
  let failed = 0;

  for (const entry of catalog) {
    const dir = path.join(SKILLS_DIR, entry.category, entry.name);
    const filePath = path.join(dir, "SKILL.md");

    process.stdout.write(`${entry.category}/${entry.name} ... `);

    try {
      const resp = await fetch(entry.source_url);
      if (!resp.ok) {
        console.log(`FAIL (HTTP ${resp.status})`);
        failed++;
        continue;
      }
      const content = await resp.text();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content);
      console.log("OK");
      succeeded++;
    } catch (err: any) {
      console.log(`FAIL (${err.message})`);
      failed++;
    }
  }

  console.log(`\nDone: ${succeeded} succeeded, ${failed} failed out of ${catalog.length} skills.`);
  console.log(`Skills written to: ${SKILLS_DIR}`);
}

main().catch(console.error);
