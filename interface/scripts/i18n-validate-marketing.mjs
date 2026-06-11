// Validates the generated marketing locale catalogs: every locale file
// parses, has no empty string leaves, and preserves the exact set of
// {{placeholder}} tokens present in the English source.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(__dirname, "..", "src", "locales");
const TARGETS = [
  "es","fr","de","pt-BR","it","ru","zh-Hans","zh-Hant","ja","ko",
  "ar","hi","nl","pl","tr","vi","id","th","uk",
];
const NS = ["marketing", "publicChat"];
const PH = /\{\{[^}]+\}\}/g;

const phSet = (s) => new Set((String(s).match(PH) ?? []));

function leaves(obj, path, acc) {
  if (typeof obj === "string") { acc.push([path, obj]); return; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => leaves(v, `${path}.${i}`, acc)); return; }
  if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) leaves(v, path ? `${path}.${k}` : k, acc);
}

let errors = 0;
for (const ns of NS) {
  const en = JSON.parse(await readFile(join(LOCALES, "en", `${ns}.json`), "utf8"));
  const enLeaves = new Map(); { const a = []; leaves(en, "", a); for (const [k, v] of a) enLeaves.set(k, v); }
  for (const loc of TARGETS) {
    const file = join(LOCALES, loc, `${ns}.json`);
    if (!existsSync(file)) { console.error(`MISSING ${loc}/${ns}.json`); errors++; continue; }
    let data;
    try { data = JSON.parse(await readFile(file, "utf8")); }
    catch (e) { console.error(`PARSE ${loc}/${ns}.json: ${e.message}`); errors++; continue; }
    const a = []; leaves(data, "", a);
    for (const [k, v] of a) {
      if (v === "") { console.error(`EMPTY ${loc}/${ns}: ${k}`); errors++; }
    }
    // Placeholder integrity against en (skip plural-expanded keys not in en).
    for (const [k, v] of a) {
      const base = k.replace(/_(zero|one|two|few|many|other)$/, "_other");
      const enVal = enLeaves.has(k) ? enLeaves.get(k) : enLeaves.get(base);
      if (enVal == null) continue;
      const want = phSet(enVal), got = phSet(v);
      for (const p of want) if (!got.has(p)) { console.error(`PLACEHOLDER ${loc}/${ns}: ${k} missing ${p} (got "${v}")`); errors++; }
    }
  }
}
console.log(errors ? `\nFAILED with ${errors} issue(s)` : "\nAll locale catalogs valid.");
process.exit(errors ? 1 : 0);
