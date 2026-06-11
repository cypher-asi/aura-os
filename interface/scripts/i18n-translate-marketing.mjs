// Machine-translates the public marketing surface into every supported
// locale. Source of truth is the English catalog under
// src/locales/en/{marketing,publicChat,nav}.json plus the expertise detail
// data in src/views/marketing/ExpertiseDetailView/expertiseData.ts.
//
// For each non-English locale we write:
//   - src/locales/<locale>/marketing.json   (full, incl. expertise.entries)
//   - src/locales/<locale>/publicChat.json   (full)
//   - src/locales/<locale>/nav.json          (existing keys preserved; gaps filled)
//
// Translation uses the public Google translate endpoint. `{{var}}`
// interpolation tokens are preserved exactly by translating only the text
// between them, and i18next plural keys are expanded to each locale's CLDR
// categories. Identical source strings are translated once per locale.
//
// Run:  node scripts/i18n-translate-marketing.mjs [locale ...]
//   (no args = all locales)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");
const LOCALES_DIR = join(SRC, "locales");

// Our locale code -> Google Translate target code.
const GOOGLE_CODE = {
  es: "es",
  fr: "fr",
  de: "de",
  "pt-BR": "pt",
  it: "it",
  ru: "ru",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
  ja: "ja",
  ko: "ko",
  ar: "ar",
  hi: "hi",
  nl: "nl",
  pl: "pl",
  tr: "tr",
  vi: "vi",
  id: "id",
  th: "th",
  uk: "uk",
};

const ALL_LOCALES = Object.keys(GOOGLE_CODE);

// Keys whose values are units/symbols we never want machine-mangled.
const SKIP_KEYS = new Set([
  "pricing.cadenceMonthly",
  "pricing.cadenceYearly",
]);

const PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;
const HAS_LETTER_RE = /\p{L}/u;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

const cache = new Map(); // `${tl}\u0000${text}` -> translated

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapPool(items, limit, fn) {
  let i = 0;
  let done = 0;
  const total = items.length;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
      done++;
      if (done % 50 === 0 || done === total) {
        process.stdout.write(`\r    translated ${done}/${total}   `);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  if (total) process.stdout.write("\n");
}

/** Collect every translatable string leaf under `node`. */
function collectStrings(node, keyPath, acc) {
  if (typeof node === "string") {
    if (!SKIP_KEYS.has(keyPath) && node && HAS_LETTER_RE.test(node)) {
      acc.add(node);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectStrings(v, `${keyPath}.${i}`, acc));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      collectStrings(v, joinKey(keyPath, k), acc);
    }
  }
}

async function translateText(text, tl) {
  if (!text || !HAS_LETTER_RE.test(text)) return text;
  const key = `${tl}\u0000${text}`;
  if (cache.has(key)) return cache.get(key);

  // Preserve {{...}} tokens: translate only the segments between them.
  const tokens = text.match(PLACEHOLDER_RE) ?? [];
  const segments = text.split(PLACEHOLDER_RE);
  const translatedSegments = [];
  for (const seg of segments) {
    translatedSegments.push(seg.trim() ? await translateRaw(seg, tl) : seg);
  }
  let result = "";
  for (let i = 0; i < translatedSegments.length; i++) {
    result += translatedSegments[i];
    if (i < tokens.length) result += tokens[i];
  }
  cache.set(key, result);
  return result;
}

async function translateRaw(text, tl) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" +
    encodeURIComponent(tl) +
    "&dt=t&q=" +
    encodeURIComponent(text);
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const parts = json[0] ?? [];
      // Preserve leading/trailing whitespace of the original segment.
      const lead = text.match(/^\s*/)[0];
      const trail = text.match(/\s*$/)[0];
      const body = parts.map((p) => p[0]).join("").trim();
      return lead + body + trail;
    } catch (err) {
      lastErr = err;
      await sleep(400 * (attempt + 1));
    }
  }
  throw new Error(`translate failed for "${text}" -> ${tl}: ${lastErr}`);
}

/**
 * Deep-translate a JSON node. Handles i18next plural groups (sibling keys
 * ending in `_one` / `_other`) by emitting the target locale's CLDR
 * cardinal categories.
 */
async function translateNode(node, tl, locale, keyPath) {
  if (typeof node === "string") {
    if (SKIP_KEYS.has(keyPath)) return node;
    return translateText(node, tl);
  }
  if (Array.isArray(node)) {
    const out = [];
    for (let i = 0; i < node.length; i++) {
      out.push(await translateNode(node[i], tl, locale, `${keyPath}.${i}`));
    }
    return out;
  }
  const out = {};
  const pluralBases = collectPluralBases(node);
  const categories = new Intl.PluralRules(locale, {
    type: "cardinal",
  }).resolvedOptions().pluralCategories;

  for (const [k, v] of Object.entries(node)) {
    const base = pluralBaseOf(k);
    if (base && pluralBases.has(base)) continue; // handled below
    out[k] = await translateNode(v, tl, locale, joinKey(keyPath, k));
  }
  for (const base of pluralBases) {
    const oneSrc = node[`${base}_one`];
    const otherSrc = node[`${base}_other`] ?? oneSrc;
    const oneT = await translateText(oneSrc, tl);
    const otherT = await translateText(otherSrc, tl);
    for (const cat of categories) {
      out[`${base}_${cat}`] = cat === "one" ? oneT : otherT;
    }
  }
  return out;
}

function pluralBaseOf(key) {
  const m = key.match(/^(.*)_(one|other)$/);
  return m ? m[1] : null;
}

function collectPluralBases(obj) {
  const bases = new Set();
  for (const k of Object.keys(obj)) {
    const b = pluralBaseOf(k);
    if (b) bases.add(b);
  }
  return bases;
}

function joinKey(prefix, key) {
  return prefix ? `${prefix}.${key}` : key;
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}

async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(sortDeep(data), null, 2) + "\n", "utf8");
}

async function main() {
  const requested = process.argv.slice(2);
  const locales = requested.length ? requested : ALL_LOCALES;

  const enMarketing = await readJson(join(LOCALES_DIR, "en", "marketing.json"));
  const enPublicChat = await readJson(
    join(LOCALES_DIR, "en", "publicChat.json"),
  );
  const enNav = await readJson(join(LOCALES_DIR, "en", "nav.json"));

  const marketingSource = enMarketing;

  for (const locale of locales) {
    const tl = GOOGLE_CODE[locale];
    if (!tl) {
      console.warn(`skip unknown locale ${locale}`);
      continue;
    }
    console.log(`\n== ${locale} (${tl}) ==`);

    const unique = new Set();
    collectStrings(marketingSource, "", unique);
    collectStrings(enPublicChat, "", unique);
    collectStrings(enNav, "", unique);
    await mapPool([...unique], 8, (text) => translateText(text, tl));

    console.log("  marketing.json");
    const marketing = await translateNode(marketingSource, tl, locale, "");
    await writeJson(join(LOCALES_DIR, locale, "marketing.json"), marketing);

    console.log("  publicChat.json");
    const publicChat = await translateNode(enPublicChat, tl, locale, "");
    await writeJson(join(LOCALES_DIR, locale, "publicChat.json"), publicChat);

    console.log("  nav.json (fill gaps)");
    const navFile = join(LOCALES_DIR, locale, "nav.json");
    const existingNav = existsSync(navFile) ? await readJson(navFile) : {};
    const nav = { ...existingNav };
    for (const [k, v] of Object.entries(enNav)) {
      if (!nav[k]) nav[k] = await translateText(v, tl);
    }
    await writeJson(navFile, nav);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
