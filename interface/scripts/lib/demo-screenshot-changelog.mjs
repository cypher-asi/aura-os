import path from "node:path";
import { promises as fs } from "node:fs";

const DEFAULT_CHANGELOG_BASE_URL = "https://cypher-asi.github.io/aura-os/changelog";

function isUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function stripInlineCode(value) {
  return String(value || "")
    .trim()
    .replace(/^`+/, "")
    .replace(/`+$/, "")
    .trim();
}

function tokenize(values) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || "").toLowerCase().split(/[^a-z0-9]+/g))
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  );
}

function clipText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function inferAreas(textValues) {
  const haystack = textValues.join(" ").toLowerCase();
  const rules = [
    {
      area: "Interface",
      patterns: [/feedback/, /comment/, /sidekick/, /chat/, /rename/, /notes/, /editor/, /thread/, /task/, /spec/],
    },
    {
      area: "Desktop",
      patterns: [/desktop/, /updater/, /loopback/, /server_base_url/, /vite_api_url/, /ephemeral port/],
    },
    {
      area: "Release Infrastructure",
      patterns: [/release/, /nightly/, /workflow/, /android/, /linux/, /sidecar/, /artifact/, /packaging/, /ci/],
    },
    {
      area: "Mobile",
      patterns: [/ios/, /android/, /mobile/],
    },
  ];

  return rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(haystack)))
    .map((rule) => ({ area: rule.area }));
}

function parseMarkdownChangelog(markdown, sourceLabel) {
  const text = String(markdown || "").replace(/\r\n/g, "\n").trim();
  const lines = text.split("\n");
  const titleLine = lines.find((line) => /^#\s+/.test(line));
  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : "Aura changelog";

  const metadata = {};
  for (const line of lines) {
    const match = line.match(/^-+\s*([^:]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    metadata[match[1].toLowerCase().trim()] = stripInlineCode(match[2]);
  }

  const sections = [];
  let currentSection = null;
  let introLines = [];
  let readingIntro = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      if (currentSection) {
        continue;
      }
    }

    if (/^<!--[\s\S]*-->$/.test(trimmed)) {
      continue;
    }

    if (/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) {
      continue;
    }

    if (/^#\s+/.test(line)) {
      readingIntro = false;
      continue;
    }

    if (/^##\s+/.test(line)) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        heading: line.replace(/^##\s+/, "").trim(),
        paragraphs: [],
        bullets: [],
      };
      readingIntro = false;
      continue;
    }

    if (!currentSection) {
      if (line.startsWith("- ")) {
        continue;
      }
      if (trimmed) {
        readingIntro = true;
      }
      if (readingIntro) {
        introLines.push(trimmed);
      }
      continue;
    }

    if (/^- /.test(trimmed)) {
      currentSection.bullets.push(trimmed.replace(/^- /, ""));
      continue;
    }

    if (trimmed) {
      currentSection.paragraphs.push(trimmed);
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  const highlightsSection = sections.find((section) => section.heading.toLowerCase() === "highlights");
  const highlights = highlightsSection?.bullets.length
    ? highlightsSection.bullets.map((item) => stripInlineCode(item))
    : sections.flatMap((section) => section.bullets.slice(0, 1)).slice(0, 5).map((item) => stripInlineCode(item));

  const renderedEntries = sections
    .filter((section) => section.heading.toLowerCase() !== "highlights")
    .map((section) => ({
      title: section.heading,
      summary: clipText(section.paragraphs.join(" "), 280),
      items: section.bullets.map((item) => ({ text: stripInlineCode(item) })),
    }));

  const textValues = [
    title,
    introLines.join(" "),
    ...highlights,
    ...renderedEntries.flatMap((entry) => [
      entry.title,
      entry.summary,
      ...entry.items.map((item) => item.text),
    ]),
  ];

  return {
    sourceType: "markdown",
    sourceLabel,
    channel: metadata.channel || null,
    version: metadata.version || null,
    date: metadata.date || null,
    releaseUrl: metadata.release || null,
    rendered: {
      title,
      intro: clipText(introLines.join(" "), 400),
      highlights,
      entries: renderedEntries,
    },
    top_areas: inferAreas(textValues),
    searchTerms: tokenize(textValues),
    raw: text,
  };
}

function normalizeJsonChangelog(document, sourceLabel) {
  const renderedSource = document?.rendered && typeof document.rendered === "object"
    ? document.rendered
    : document;
  const rendered = {
    title: renderedSource?.title || renderedSource?.day_title || "Aura changelog",
    intro: renderedSource?.intro || renderedSource?.day_intro || "",
    highlights: Array.isArray(renderedSource?.highlights) ? renderedSource.highlights : [],
    entries: Array.isArray(renderedSource?.entries) ? renderedSource.entries : [],
  };
  const highlights = rendered.highlights;
  const entries = rendered.entries;
  const topAreas = Array.isArray(document?.top_areas) ? document.top_areas : [];
  const textValues = [
    rendered.title,
    rendered.intro,
    ...highlights,
    ...entries.flatMap((entry) => [
      entry?.title,
      entry?.summary,
      ...(Array.isArray(entry?.items) ? entry.items.map((item) => item?.text) : []),
    ]),
  ];

  return {
    ...document,
    rendered,
    sourceType: "json",
    sourceLabel,
    top_areas: topAreas.length > 0 ? topAreas : inferAreas(textValues),
    searchTerms: tokenize(textValues),
    raw: JSON.stringify(document, null, 2),
  };
}

async function readRemoteSource(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch changelog (${response.status}) from ${url}`);
  }
  return {
    body: await response.text(),
    contentType: response.headers.get("content-type") || "",
  };
}

async function readLocalSource(filePath) {
  return {
    body: await fs.readFile(path.resolve(filePath), "utf8"),
    contentType: "",
  };
}

export function resolveDefaultChangelogSource(channel = "nightly") {
  return `${DEFAULT_CHANGELOG_BASE_URL}/${String(channel || "nightly").trim()}/latest.md`;
}

export async function loadDemoScreenshotChangelog({ changelog, channel = "nightly" } = {}) {
  const source = String(changelog || resolveDefaultChangelogSource(channel)).trim();
  const { body, contentType } = isUrl(source)
    ? await readRemoteSource(source)
    : await readLocalSource(source);
  const normalizedBody = String(body || "").trim();
  const looksJson = contentType.includes("application/json") || source.toLowerCase().endsWith(".json");

  const document = looksJson
    ? normalizeJsonChangelog(JSON.parse(normalizedBody), source)
    : parseMarkdownChangelog(normalizedBody, source);

  return {
    source,
    format: looksJson ? "json" : "markdown",
    document,
  };
}
