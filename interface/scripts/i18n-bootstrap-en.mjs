// One-time bootstrap: merges the marketing strings that were previously
// hardcoded in components / data modules into the English source catalog
// (src/locales/en/marketing.json), so the catalog becomes the single
// source of truth for the translation script.
//
// Large data-derived sets (expertise detail entries, discipline pills,
// capability phrase lists) are read directly from their TS data modules
// via esbuild so we never hand-transcribe them. Everything else is the
// hand-authored ADDITIONS object below (English values lifted verbatim
// from the components they came from).
//
// Re-runnable and idempotent: it deep-merges without overwriting existing
// non-empty values. Run:  node scripts/i18n-bootstrap-en.mjs

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");
const EN = join(SRC, "locales", "en", "marketing.json");

async function importTs(relPath) {
  const file = join(SRC, relPath);
  const ts = await readFile(file, "utf8");
  const { code } = await transform(ts, { loader: "tsx", format: "esm" });
  const url = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  return import(url);
}

function slug(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function buildDerived() {
  const expertise = await importTs(
    "views/marketing/ExpertiseDetailView/expertiseData.ts",
  );
  const examples = await importTs(
    "views/marketing/SpecQuadrantSection/expertiseExamples.tsx",
  );

  // expertise.entries.<slug>
  const entries = {};
  for (const e of [...expertise.CAPABILITIES, ...expertise.INDUSTRIES]) {
    entries[e.slug] = {
      label: e.label,
      headline: e.headline,
      heroBlurb: e.heroBlurb,
      overview: e.overview,
      useCases: e.useCases.map((u) => ({
        title: u.title,
        description: u.description,
      })),
    };
  }

  // disciplines.<slug> (pill labels) + capabilities.<slug>.<i>
  const disciplines = {};
  const capabilities = {};
  for (const label of examples.EXPERTISES) {
    const id = slug(label);
    disciplines[id] = label;
    const list = examples.EXPERTISE_CAPABILITIES[label] ?? [];
    if (list.length) {
      capabilities[id] = Object.fromEntries(list.map((c, i) => [String(i), c]));
    }
  }

  return { entries, disciplines, capabilities };
}

const ADDITIONS = {
  agentBuilder: {
    configure: "CONFIGURE",
    privateAgent: "YOUR PRIVATE AGENT",
    integrations: "100+ Integrations",
    buildProgressAria: "Build progress: {{step}}",
    steps: {
      0: { label: "Identity", description: "Create your agent's name and 3D avatar." },
      1: { label: "Expertise", description: "Build your agent's core skills and knowledge." },
      2: { label: "Integrations", description: "Grant your agent secure access to your data." },
      3: { label: "Connections", description: "Link your agent to iMessage, Telegram, and more." },
      4: { label: "Automations", description: "Schedule the daily tasks your agent runs for you." },
      5: { label: "Launch", description: "Birth your agent into the world." },
    },
  },
  agentConsole: {
    states: {
      private: "Private",
      secure: "Secure",
      verifiable: "Verifiable",
      openSource: "Open Source",
    },
    previous: "Previous",
    next: "Next",
  },
  agentMarquee: {
    ariaLabel: "AURA agents",
  },
  alwaysOn: {
    ariaLabel: "Always on",
  },
  connectedConsole: {
    vibe: "VIBE",
  },
  footer: {
    columns: {
      0: {
        heading: "Product",
        links: { 0: "Agents", 1: "Code", 2: "OS" },
      },
      1: {
        heading: "Resources",
        links: { 0: "Pricing", 1: "Downloads", 2: "Changelog", 3: "Blog", 4: "Docs" },
      },
      2: { heading: "Connect" },
      3: {
        heading: "Legal",
        links: { 0: "Terms of Service", 1: "Privacy Policy" },
      },
    },
  },
  mobileChat: {
    subtitle: "online · on your VM",
    messagePlaceholder: "Message your agent…",
    conversations: {
      frontend: {
        agentName: "Frontend",
        messages: {
          0: "Add a dark mode toggle to settings",
          1: "On it — adding a toggle wired to the theme store.",
          3: "Done. Want it to follow the OS by default?",
        },
      },
      backend: {
        agentName: "Backend",
        messages: {
          0: "Why is /pricing slow today?",
          1: "Checking the query plan — looks like a missing index.",
          3: "Adding an index on (name). Should drop to ~5ms.",
        },
      },
      reviewer: {
        agentName: "Reviewer",
        messages: {
          0: "Ship the release once CI is green",
          1: "Watching the pipeline now.",
          3: "All green. Merging and tagging the release.",
        },
      },
    },
  },
  mockChatInput: {
    examples: {
      0: "Refactor this React component, update the tests, and open a PR",
      1: "Plan a weekend trip to Lisbon and book the flights",
      2: "Generate a warm editorial photo of a tiny jungle library at dusk",
      3: "Turn these product screenshots into a 12 second launch video",
      4: "Create a 3D model of a modular desk organizer with cable clips",
      5: "Compare three daycares near me and schedule tours next week",
      6: "Find why this dashboard query times out and ship the fix",
      7: "Design a logo system for my neighborhood coffee side project",
      8: "Make a calm onboarding clip from this rough screen recording",
      9: "Model a foldable travel tripod with labeled moving parts",
      10: "Coordinate my cross-country move with movers, utilities, and flights",
      11: "Audit the auth flow for race conditions and write a migration plan",
      12: "Create campaign visuals for a luxury electric camper van in snow",
      13: "Storyboard and render a cinematic trailer for an AI music tool",
      14: "Generate a game-ready spaceship cockpit with clean topology",
      15: "Build a hiring plan for a five-person robotics research team",
      16: "Port this payment service to queues without dropping events",
      17: "Visualize a Mars greenhouse city for a science museum exhibit",
      18: "Create an investor demo video from this technical prototype",
      19: "Design a manufacturable drone chassis with battery access",
    },
  },
  models: {
    modeOptions: { all: "All", text: "Text", image: "Image", video: "Video", "3d": "3D" },
    statusOptions: { all: "All", live: "Live", soon: "Soon" },
    modeTitles: {
      all: "All Models",
      text: "Text Models",
      image: "Image Models",
      video: "Video Models",
      "3d": "3D Models",
    },
    cardAria: "{{name}} by {{provider}}",
  },
  personas: {
    creator: { name: "Creator", role: "Creator" },
    vibecoder: { name: "Vibecoder", role: "Creative coder" },
    "solo-builder": { name: "Solo Builder", role: "Indie engineer" },
    "giga-brain": { name: "Giga Brain", role: "Research lead" },
    coordinator: { name: "Coordinator", role: "Team orchestrator" },
    researcher: { name: "Researcher", role: "Research analyst" },
    "cypher-punk": { name: "Cypher Punk", role: "Security operator" },
  },
  skills: {
    "coding-agent": "Code",
    "skill-creator": "Create",
    gifgrep: "Images",
    "video-frames": "Video",
    "nano-pdf": "PDFs",
    summarize: "Summarize",
    notion: "Notes",
    trello: "Boards",
    himalaya: "Email",
    taskflow: "Tasks",
    goplaces: "Maps",
    openhue: "Lights",
    "spotify-player": "Music",
    "voice-call": "Call",
    healthcheck: "Health",
  },
  specQuadrant: {
    intelligence: "INTELLIGENCE",
    withoutLimits: "WITHOUT LIMITS",
    activation: "ACTIVATION",
    online: "ONLINE",
    featureHighlightsAria: "Feature highlights",
    expertiseAria: "Expertise",
    examples: { post: "Post", email: "Email", ads: "Ads", seo: "SEO" },
  },
  trust: {
    marqueeTerms: {
      0: "Sandboxed VM",
      1: "Trusted Execution",
      2: "Attested Boot",
      3: "Confidential Compute",
      4: "Encrypted Memory",
      5: "Isolated Runtime",
    },
    insertTokens: "Insert tokens",
    uptime: "Uptime",
    attestation: "Attestation",
    vmLabel: "VM",
    readouts: {
      router: {
        title: "AURA Router",
        description:
          "A secure routing layer brokering every request across open source and frontier models.",
      },
      harness: {
        title: "AURA Runtime Harness",
        description:
          "All data flows through AURA's custom harness. Every step is atomic, immutable and audited.",
      },
      swarm: {
        title: "AURA Swarm",
        description:
          "An isolated trusted execution environment. Your keys never leave it and the host sees nothing.",
      },
    },
  },
};

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/** Deep-merge `src` into `dst` without overwriting existing non-empty leaves. */
function mergeInto(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (isPlainObject(v)) {
      if (!isPlainObject(dst[k])) dst[k] = {};
      mergeInto(dst[k], v);
    } else if (dst[k] === undefined || dst[k] === "") {
      dst[k] = v;
    }
  }
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}

async function main() {
  const en = JSON.parse(await readFile(EN, "utf8"));
  const { entries, disciplines, capabilities } = await buildDerived();

  mergeInto(en, ADDITIONS);
  en.expertise = en.expertise ?? {};
  mergeInto(en.expertise, { entries });
  mergeInto(en, { disciplines, capabilities });

  await writeFile(EN, JSON.stringify(sortDeep(en), null, 2) + "\n", "utf8");
  console.log("Bootstrapped en/marketing.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
