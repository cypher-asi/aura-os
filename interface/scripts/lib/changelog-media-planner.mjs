import { normalizeCaptureSeedPlan } from "./changelog-media-seed-plan.mjs";
import { summarizeChangelogMediaKnowledge } from "./changelog-media-knowledge.mjs";

const DEFAULT_MAX_CANDIDATES = 3;
const DEFAULT_ENTRY_CHUNK_SIZE = 20;
const DEFAULT_PLANNER_TIMEOUT_MS = 120_000;
const MAX_PROMPT_CHARS = 52000;
const MIN_CAPTURE_CONFIDENCE = 0.6;
const PREFERRED_CAPTURE_CONFIDENCE = 0.7;
const SHELL_CAPTURE_FALLBACK_APP_ID = "aura3d";
const SHELL_CAPTURE_FALLBACK_PATH = "/3d";
const VISUAL_OPPORTUNITY_LIMIT = 48;
const VISUAL_ACTION_PATTERN = /\b(?:add|adds|added|launch|launched|ship|shipped|new|introduce|introduced|debut|debuted|scaffold|scaffolded|redesign|redesigned|rebuild|rebuilt|revamp|sort|sorted|filter|filtered|reorder|ordered|group|grouped|search|viewer|picker|selector|modal|composer|panel|sidebar|sidekick|taskbar|toolbar|dashboard|stats|metrics|chart|table|tabs|feed|feedback|notes|browser|debug app|aura 3d|3d|model picker|model selector|webgl|marketplace|integrations|profile|settings|gallery|lightbox|kanban|process canvas|desktop shell|chrome|window controls|copy button|inline rename|context menu|avatar|update control|browser tab|error page)\b/i;
const VISUAL_STYLE_PATTERN = /\b(?:style|polish|align|size|round|gap|border|radius|background|layout|height|width|hover|focus|icon|floating|capsule)\b/i;
const LOW_SIGNAL_SUBJECT_PATTERN = /\b(?:retrigger|merge|rustfmt|lint|format|move generic|shared\/|types\/|api\/|utils\/|hooks\/|ci|workflow|release asset|gh-pages|test|tests|fixture|rubric|docs?)\b/i;
const INTERNAL_REFACTOR_SUBJECT_PATTERN = /\b(?:move|moved|relocat|migrat|shared\/|generic|scaffold|types\/|api\/|utils\/|hooks\/|lib\/)\b/i;
const INTERNAL_REFACTOR_PATTERN = /\b(?:refactor|relocat|migrat|move|moved|shared\/|generic|scaffold|directory|module scaffolding|types\/|api\/|utils\/|hooks\/|lib\/)\b/i;
const EXPLICIT_VISIBLE_CHANGE_PATTERN = /\b(?:add|show|surface|display|render|open|select|sort|filter|redesign|restyle|polish|style|resize|layout|panel|picker|dashboard|gallery|editor|screen|visible|user-visible)\b/i;
const EXPLICIT_REFACTOR_VISIBLE_PATTERN = /\b(?:user-visible|visible|render|display|show|screen|panel|dashboard|picker|gallery|editor|chrome|layout|style|redesign|restyle)\b/i;
const DESKTOP_PRODUCT_PATTERN = /\b(?:desktop|web|browser|chat|agent|project|task|process|feedback|notes|model picker|aura 3d|3d|debug|settings|feed|integrations|marketplace)\b/i;
const MOBILE_ONLY_PATTERN = /\b(?:mobile|android|ios|iphone|ipad|native app|apk|ipa)\b/i;
const DESKTOP_UI_FILE_PATTERN = /^interface\/src\/(?:apps|components|views|routes|layout|features)\//;
const ENTRY_ALIGNMENT_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "into",
  "from",
  "now",
  "new",
  "around",
  "every",
  "through",
  "driven",
  "scoped",
  "shared",
  "major",
  "minor",
  "update",
  "updates",
  "rebuilt",
  "hardened",
]);

export const CHANGELOG_MEDIA_PLAN_TOOL = {
  name: "submit_changelog_media_plan",
  description: "Submit the shortlist of Aura changelog entries that deserve Browser Use desktop screenshots.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates", "skipped"],
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "entryId",
            "title",
            "shouldCapture",
            "reason",
            "targetAppId",
            "targetPath",
            "proofGoal",
            "publicCaption",
            "confidence",
            "changedFiles",
          ],
          properties: {
            entryId: { type: "string" },
            title: { type: "string" },
            shouldCapture: { type: "boolean" },
            reason: { type: "string" },
            targetAppId: { type: ["string", "null"] },
            targetPath: { type: ["string", "null"] },
            proofGoal: { type: ["string", "null"] },
            publicCaption: { type: ["string", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            changedFiles: { type: "array", items: { type: "string" } },
            seedPlan: {
              type: ["object", "null"],
              additionalProperties: false,
              required: ["capabilities", "requiredState", "readinessSignals"],
              properties: {
                mode: { type: ["string", "null"] },
                capabilities: { type: "array", items: { type: "string" } },
                requiredState: { type: "array", items: { type: "string" } },
                proofBoundary: { type: "array", items: { type: "string" } },
                contextBoundary: { type: "array", items: { type: "string" } },
                readinessSignals: { type: "array", items: { type: "string" } },
                avoid: { type: "array", items: { type: "string" } },
                notes: { type: ["string", "null"] },
              },
            },
          },
        },
      },
      skipped: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entryId", "title", "reason", "category"],
          properties: {
            entryId: { type: "string" },
            title: { type: "string" },
            reason: { type: "string" },
            category: {
              type: "string",
              enum: [
                "mobile-only",
                "backend-only",
                "infra-only",
                "release-only",
                "docs-only",
                "test-only",
                "not-visually-provable",
                "too-ambiguous",
                "candidate-limit",
              ],
            },
          },
        },
      },
    },
  },
};

function truncateText(value, maxChars = MAX_PROMPT_CHARS) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 24).trimEnd()}\n... [truncated]`;
}

function normalizeString(value) {
  return String(value || "").trim();
}

function unique(values, limit = 80) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeString)
      .filter(Boolean),
  )].slice(0, limit);
}

function toEntryId(entry, index) {
  return normalizeString(entry?.id || entry?.batch_id || entry?.entryId || `entry-${index + 1}`);
}

function extractEntryFiles(entry) {
  const directFiles = Array.isArray(entry?.changedFiles) ? entry.changedFiles : [];
  const itemFiles = Array.isArray(entry?.items)
    ? entry.items.flatMap((item) => item?.changed_files || item?.changedFiles || [])
    : [];
  const commitFiles = Array.isArray(entry?.commits)
    ? entry.commits.flatMap((commit) => commit?.files || [])
    : [];
  return unique([...directFiles, ...itemFiles, ...commitFiles]);
}

function shortSha(value) {
  return normalizeString(value).slice(0, 12);
}

function isDesktopUiFile(filePath) {
  const normalized = normalizeString(filePath);
  return DESKTOP_UI_FILE_PATTERN.test(normalized)
    && !/\.test\.|\.spec\.|__tests__|\/mobile/i.test(normalized);
}

function isMobileOnlyVisualText(value) {
  const text = normalizeString(value);
  return MOBILE_ONLY_PATTERN.test(text) && !DESKTOP_PRODUCT_PATTERN.test(text);
}

function visualOpportunityScore(commit, itemTexts = []) {
  const subject = normalizeString(commit?.subject || commit?.cleanSubject);
  const body = normalizeString(commit?.body);
  const files = Array.isArray(commit?.files) ? commit.files.map(normalizeString).filter(Boolean) : [];
  const uiFiles = files.filter(isDesktopUiFile);
  const text = [subject, ...itemTexts, body].filter(Boolean).join("\n");
  if (isMobileOnlyVisualText(text) && uiFiles.length === 0) return -20;
  if (LOW_SIGNAL_SUBJECT_PATTERN.test(subject) && !VISUAL_ACTION_PATTERN.test(text)) return -12;
  if (/^refactor\b|^refactor\(/i.test(subject) && INTERNAL_REFACTOR_SUBJECT_PATTERN.test(subject)) {
    return -12;
  }
  if (/^refactor\b|^refactor\(/i.test(subject) && INTERNAL_REFACTOR_PATTERN.test(text) && !EXPLICIT_REFACTOR_VISIBLE_PATTERN.test(text)) {
    return -12;
  }

  let score = 0;
  if (VISUAL_ACTION_PATTERN.test(text)) score += 12;
  if (/^(?:feat\b|feat\(|style\b|style\(|ui\b|ui\(|desktop-shell\b|add\b|make\b|show\b|move\b|route\b|wire\b|redesign\b|rebuild\b|introduc)/i.test(subject)) score += 8;
  if (/^fix\b|^fix\(/i.test(subject) && VISUAL_STYLE_PATTERN.test(subject)) score += 5;
  if (uiFiles.length > 0) score += Math.min(8, uiFiles.length * 2);
  if (/\b(?:app|surface|screen|route|panel|picker|viewer|modal|dashboard|gallery|composer|sidekick|taskbar|layout|shell)\b/i.test(text)) score += 4;
  if (/^refactor\b/i.test(subject) && !/\b(?:app shell|route-driven|feedback|notes|desktop|screen|ui)\b/i.test(subject)) score -= 8;
  if (isMobileOnlyVisualText(text)) score -= 12;
  return score;
}

function appTokens(app) {
  return unique([
    app?.id,
    app?.label,
    app?.path,
    ...(app?.keywords || []),
    ...(app?.sourceContext?.surfaces || []),
    ...(app?.sourceContext?.contexts || []),
    ...(app?.sourceContext?.contextAnchors || []),
    ...(app?.sourceContext?.proofSignals || []),
    ...(app?.captureSeedProfile?.capabilities || []),
  ], 80).map((value) => value.toLowerCase());
}

function scoreSitemapAppForOpportunity(app, commit, itemTexts = []) {
  const files = Array.isArray(commit?.files) ? commit.files.map(normalizeString).filter(Boolean) : [];
  const haystack = [
    commit?.subject,
    commit?.body,
    ...itemTexts,
    ...files,
  ].filter(Boolean).join("\n").toLowerCase();
  let score = 0;
  if (files.some((file) => file.includes(`/apps/${app.id}/`) || file.includes(`/apps/${app.id}.`))) score += 12;
  if (files.some((file) => file.startsWith(`interface/src/apps/${app.id}/`))) score += 14;
  if (app.id === "projects" && files.some((file) => /interface\/src\/(?:views\/Project|components\/Project|stores\/projects|queries\/project)/i.test(file))) score += 10;
  if (app.id === "agents" && files.some((file) => /interface\/src\/components\/(?:ChatInputBar|AgentChatView|ChatPanel|AgentWindow)/i.test(file))) score += 10;
  if (app.id === "desktop" && files.some((file) => /interface\/src\/components\/(?:DesktopShell|BottomTaskbar|AppNavRail|AppShell)/i.test(file))) score += 10;
  for (const token of appTokens(app)) {
    if (token && token.length >= 3 && haystack.includes(token)) score += token === app.id ? 4 : 2;
  }
  return score;
}

function alignmentTokens(value) {
  return [...String(value || "").toLowerCase().matchAll(/[a-z0-9][a-z0-9.-]{2,}/g)]
    .map((match) => match[0].replace(/s$/i, ""))
    .filter((token) => token.length >= 3 && !ENTRY_ALIGNMENT_STOP_WORDS.has(token));
}

function entryAlignmentDetails({ entryTitle, itemText, subject }) {
  const titleTokens = [...new Set(alignmentTokens(entryTitle))];
  const proofTokens = new Set(alignmentTokens([itemText, subject].filter(Boolean).join("\n")));
  const matchedTitleTokens = titleTokens.filter((token) => proofTokens.has(token));
  const score = titleTokens.length > 0 ? matchedTitleTokens.length / titleTokens.length : 0;
  return {
    score: Number(score.toFixed(2)),
    strength: score >= 0.35 ? "strong" : score >= 0.18 ? "moderate" : "weak",
    matchedTitleTokens,
  };
}

function entryItemsByCommit(changelog) {
  const renderedEntries = Array.isArray(changelog?.rendered?.entries)
    ? changelog.rendered.entries
    : Array.isArray(changelog?.entries)
      ? changelog.entries
      : [];
  const bySha = new Map();
  for (const [entryIndex, entry] of renderedEntries.entries()) {
    const entryId = toEntryId(entry, entryIndex);
    const entryTitle = normalizeString(entry?.title || entry?.heading || `Entry ${entryIndex + 1}`);
    for (const [itemIndex, item] of (Array.isArray(entry?.items) ? entry.items : []).entries()) {
      const commitShas = unique(item?.commit_shas || item?.commitShas || []);
      for (const sha of commitShas) {
        const key = normalizeString(sha);
        if (!key) continue;
        const values = bySha.get(key) || [];
        values.push({
          entryId,
          entryTitle,
          itemIndex,
          itemText: normalizeString(item?.text || item?.summary || item?.title),
          changedFiles: unique(item?.changed_files || item?.changedFiles || []),
        });
        bySha.set(key, values);
      }
    }
  }
  return bySha;
}

function matchingCommitItems(commitSha, itemsBySha) {
  const sha = normalizeString(commitSha);
  const matches = [];
  for (const [candidateSha, items] of itemsBySha.entries()) {
    if (sha.startsWith(candidateSha) || candidateSha.startsWith(sha)) {
      matches.push(...items);
    }
  }
  return matches;
}

export function deriveVisualMediaOpportunities(changelog, {
  sitemap = null,
  allowedEntryIds = null,
  maxOpportunities = VISUAL_OPPORTUNITY_LIMIT,
} = {}) {
  const rawCommits = Array.isArray(changelog?.rawCommits) ? changelog.rawCommits : [];
  const itemsBySha = entryItemsByCommit(changelog);
  const allowedIds = allowedEntryIds
    ? new Set([...allowedEntryIds].map(normalizeString).filter(Boolean))
    : null;
  const apps = Array.isArray(sitemap?.apps) ? sitemap.apps : [];
  const opportunities = [];

  for (const commit of rawCommits) {
    const sha = normalizeString(commit?.sha);
    const matchedItems = matchingCommitItems(sha, itemsBySha);
    const itemTexts = matchedItems.map((item) => item.itemText).filter(Boolean);
    const score = visualOpportunityScore(commit, itemTexts);
    if (score < 12) continue;
    const files = unique([
      ...(Array.isArray(commit?.files) ? commit.files : []),
      ...matchedItems.flatMap((item) => item.changedFiles || []),
    ], 80);
    const uiFiles = files.filter(isDesktopUiFile);
    if (uiFiles.length === 0 && score < 18) continue;
    const rankedApps = apps
      .map((app) => ({
        id: app.id,
        label: app.label,
        path: app.path,
        runtimeSeedSupport: app.captureSeedProfile?.runtimeSeedSupport || "unknown",
        preferredStableSurface: app.captureSeedProfile?.preferredStableSurface || null,
        score: scoreSitemapAppForOpportunity(app, { ...commit, files }, itemTexts),
      }))
      .filter((app) => app.score > 0)
      .sort((left, right) => right.score - left.score || String(left.label).localeCompare(String(right.label)))
      .slice(0, 4);
    const entryTargets = matchedItems.length > 0
      ? matchedItems
      : [{ entryId: null, entryTitle: null, itemIndex: null, itemText: "" }];
    for (const item of entryTargets) {
      if (allowedIds && (!item.entryId || !allowedIds.has(item.entryId))) continue;
      opportunities.push({
        opportunityId: `${item.entryId || "raw"}:${shortSha(sha)}`,
        entryId: item.entryId,
        entryTitle: item.entryTitle,
        itemIndex: item.itemIndex,
        itemText: item.itemText,
        commitSha: shortSha(sha),
        subject: normalizeString(commit?.subject || commit?.cleanSubject),
        score,
        confidenceHint: Math.min(0.95, Math.max(0.5, score / 30)),
        entryAlignment: entryAlignmentDetails({
          entryTitle: item.entryTitle,
          itemText: item.itemText,
          subject: commit?.subject || commit?.cleanSubject,
        }),
        desktopEligible: !isMobileOnlyVisualText([commit?.subject, item.itemText].join("\n")),
        likelyApps: rankedApps,
        changedFiles: uiFiles.slice(0, 12),
        rationale: [
          VISUAL_ACTION_PATTERN.test([commit?.subject, item.itemText].join("\n")) ? "commit/bullet text names a visual product surface or UI action" : "",
          uiFiles.length > 0 ? "commit touches desktop UI files" : "",
          item.entryId ? "commit is represented inside this rendered changelog entry" : "raw commit is not represented by a rendered changelog bullet",
          rankedApps[0]?.runtimeSeedSupport === "supported" ? `top sitemap target (${rankedApps[0].id}) has supported seed data` : "",
        ].filter(Boolean),
      });
    }
  }

  return opportunities
    .sort((left, right) => (
      (right.entryAlignment?.score || 0) - (left.entryAlignment?.score || 0)
      || right.score - left.score
      || (right.likelyApps[0]?.score || 0) - (left.likelyApps[0]?.score || 0)
      || String(left.entryId || "").localeCompare(String(right.entryId || ""))
    ))
    .slice(0, maxOpportunities);
}

export function isChangelogEntryMediaPublished(entry) {
  const media = entry?.media || entry?.changelogMedia || null;
  if (!media || typeof media !== "object") return false;
  const status = normalizeString(media.status).toLowerCase();
  const assetPath = normalizeString(media.assetPath || media.asset_path || media.url || media.src);
  return status === "published" && Boolean(assetPath);
}

export function extractChangelogMediaEntries(changelog) {
  const source = changelog?.rendered || changelog;
  const entries = Array.isArray(source?.entries) ? source.entries : [];
  return entries.map((entry, index) => ({
    entryId: toEntryId(entry, index),
    title: normalizeString(entry.title || entry.heading || entry.day_title || `Entry ${index + 1}`),
    summary: normalizeString(entry.summary || entry.description || entry.body || ""),
    items: Array.isArray(entry.items)
      ? entry.items.map((item) => ({
        text: normalizeString(item.text || item.summary || item.title || ""),
        commitShas: unique(item.commit_shas || item.commitShas || []),
        changedFiles: unique(item.changed_files || item.changedFiles || []),
      }))
      : [],
    changedFiles: extractEntryFiles(entry),
    media: entry?.media || null,
    mediaPublished: isChangelogEntryMediaPublished(entry),
  }));
}

export function buildMediaPlannerPrompt({
  changelogEntries,
  sitemap,
  learnedKnowledge = null,
  commitLog = "",
  changedFiles = [],
  visualOpportunities = [],
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  retryInstruction = "",
} = {}) {
  const knowledgeSummary = summarizeChangelogMediaKnowledge(learnedKnowledge);
  return [
    "You are the Aura changelog media planner.",
    "",
    "Your job is to decide which changelog entries deserve Browser Use desktop screenshot capture before any browser automation runs.",
    "",
    "Hard rules:",
    "- Every changelog entry must appear exactly once: either in candidates or in skipped.",
    "- If an entry mixes a visible desktop product feature with infra/release work, classify it by the visible desktop product feature and make the proofGoal focus only on that feature.",
    "- Use the visual opportunity index as discovery evidence for visual sub-features hidden inside broad changelog entries. If a high-scoring opportunity has an entryId, likely sitemap app, desktop UI files, and seedable proof, prefer targeting that sub-feature instead of skipping the whole entry as too broad.",
    "- The visual opportunity index is a hint, not permission to publish weak media: keep final candidate quality strict and skip opportunities that are mobile-only, non-static, unseedable, or not user-visible.",
    "- A visible feature means the changelog/commit describes a concrete user-visible screen, control, picker, sort/filter behavior, dashboard/stat, table, chart, gallery, editor, panel, or durable state/result that can be shown in Aura. A mere mention of an app name, module, API, storage type, or internal service is not enough.",
    "- Be open to sitemap-backed screens beyond previously verified examples: if the text says a Stats, Debug, Feedback, Notes, Agents, Tasks, Process, Browser, Marketplace, Settings, or AURA 3D surface gained a visible behavior, route there with the best generic seedPlan. If it only mentions that surface incidentally, skip.",
    "- If an entry has several opportunities, choose the one with the strongest entryAlignment first, then the most static, readable, seedable desktop proof. Do not attach decorative shell/chrome media to a broad entry whose headline is about a different feature unless the headline or main bullet clearly names that chrome change.",
    "- A media image appears at the changelog entry level, so the chosen proof must feel honest next to that entry's title and bullets. If only a tiny side-detail is visual while the entry headline is about backend/concurrency/release work, skip instead of publishing misleading media.",
    "- Return at most the requested number of candidates.",
    "- Candidate screenshots must be desktop web product UI only.",
    "- Skip login, auth, sign-in, onboarding, mobile-only, native app, Android, iOS, backend-only, infra-only, release pipeline, dependency, test-only, docs-only, refactor-only, and invisible bug-fix changes.",
    "- Skip provider pricing, model catalog, routing, config, or API plumbing changes unless the changelog explicitly describes a user-visible desktop UI change such as a new option in a picker, menu, settings panel, gallery, editor, or dashboard.",
    "- Skip entries that are not meaningfully provable in one static desktop screenshot.",
    "- Skip entries whose only likely proof is a default/empty state such as 'will appear here', 'pick a project', 'select a run', or an otherwise unseeded list/detail view.",
    "- Skip transient interaction states such as hover-only UI, context menus, F2 rename fields, drag/resize states, flashing native-window paint, or keyboard-focus-only affordances unless the sitemap exposes durable data-agent proof/action handles and the seedPlan can deterministically make that state visible.",
    "- Prefer high-confidence product features that can be located from the generated sitemap and changed files.",
    "- Use each sitemap app's captureSeedProfile to choose seedPlan capabilities; if the screen would otherwise be empty, request the matching seeded demo state before capture.",
    "- Treat captureSeedProfile.runtimeSeedSupport='supported' as the safest path. If an app has unknown seed support but the changed files, route hints, and product wording clearly identify a desktop surface, you may still return it as a candidate with an explicit seedPlan that describes the missing data/readiness requirements; the downstream quality gates will decide whether it publishes.",
    "- Do not invent routes or product states that are not supported by the sitemap or commit context.",
    "- Candidates must include a targetAppId and targetPath from the sitemap. If no sitemap target exists, skip the entry.",
    "- For desktop shell, chrome, layout, taskbar, sidebar, sidekick, or floating-panel changes, do not target /desktop because it can be an empty launcher shell. Target a populated, visually rich desktop app route from the sitemap instead. Prefer AURA 3D (/3d) on the generated Image gallery surface for shell/layout proof because seeded image content makes panel boundaries and chrome more legible; use Agents only when the change itself is agent/chat-specific.",
    "- For AURA 3D, request image-gallery-populated for stable visual proof. Only request model-source-image-populated when the changelog explicitly needs the 3D model/source-image conversion surface; do not open the 3D Model tab just because the app is called AURA 3D.",
    "- Candidates should include a seedPlan that describes generic capture-state capabilities, not a one-off script. Prefer capabilities like app:<id>, project-selected, proof-data-populated, image-gallery-populated, asset-gallery-populated, agent-chat-ready, feedback-board-populated, feedback-thread-populated, notes-tree-populated, note-editor-populated, task-board-populated, process-graph-populated, feed-timeline-populated, run-history-populated, model-picker-open, settings-panel-open, generated-result-visible, feature-toggle-enabled.",
    "- The seedPlan must describe the state/data needed before capture so the browser does not land on empty/default UI. If the feature needs data to be visible, request realistic demo data for the target surface.",
    "- In seedPlan.proofBoundary, describe the feature evidence itself: the visible control/result/list/detail/menu that proves the change.",
    "- In seedPlan.contextBoundary, describe visible product context only: nearby title, tab, sidebar, toolbar, navigation, selected project, open picker, active panel, chat transcript, composer, or selected row.",
    "- Do not require the screenshot to show an internal route name, app id, file path, or literal app label if the visible UI does not naturally print it. Deterministic app/route gates verify targetAppId and targetPath separately.",
    "- Write proofGoal as a visible proof contract, not an internal routing assertion. For example, ask for a picker option plus composer/sidebar context, not a visible '/agents' or 'Agents route' label.",
    "- Do not ask for an isolated widget, thumbnail, canvas, menu, or inner card by itself. The media must show proof plus recognizable product context.",
    "- For capture planning, prefer the smallest 16:9 desktop region where the proof remains readable at changelog-card size and the context still identifies the product surface.",
    "- Browser Use should receive fewer, better candidates, but do not create a bias where only previously verified surfaces can ever receive media.",
    `- Prefer candidates at confidence ${PREFERRED_CAPTURE_CONFIDENCE.toFixed(2)} or higher. Return sitemap-backed visual desktop candidates down to ${MIN_CAPTURE_CONFIDENCE.toFixed(2)} when the remaining uncertainty is seed/readiness coverage rather than whether the change is visual.`,
    "- For each candidate, write publicCaption as a customer-facing changelog sentence. Do not use internal instructions like capture, open, show, screenshot, proof, or Browser Use.",
    "",
    `Candidate limit: ${maxCandidates}`,
    "",
    "Generated Aura sitemap:",
    truncateText(JSON.stringify(sitemap || {}, null, 2)),
    "",
    knowledgeSummary
      ? truncateText(knowledgeSummary, 16000)
      : "Curated changelog media lessons: none loaded.",
    "",
    "Changed files across release:",
    truncateText(JSON.stringify(unique(changedFiles, 160), null, 2), 12000),
    "",
    "Visual opportunity index from raw commits and changelog bullets:",
    truncateText(JSON.stringify(visualOpportunities || [], null, 2), 18000),
    "",
    "Commit log excerpt:",
    truncateText(commitLog, 16000),
    "",
    "Changelog entries:",
    truncateText(JSON.stringify(changelogEntries || [], null, 2), 20000),
    "",
    retryInstruction ? `Retry correction:\n${retryInstruction}\n` : "",
    `Call the ${CHANGELOG_MEDIA_PLAN_TOOL.name} tool exactly once.`,
  ].join("\n");
}

function clampConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function isShellChromeCandidate(candidate) {
  const text = [
    candidate?.targetAppId,
    candidate?.targetPath,
    candidate?.title,
    candidate?.proofGoal,
    candidate?.publicCaption,
    ...(candidate?.changedFiles || []),
  ].join("\n").toLowerCase();
  return candidate?.targetAppId === "desktop"
    || candidate?.targetPath === "/desktop"
    || /\b(?:desktop shell|shell chrome|bottom taskbar|taskbar|bottomtaskbar|desktopchrome|floating[- ]glass|floating panel|desktop layout)\b/.test(text)
    || /interface\/src\/components\/(?:desktopshell|bottomtaskbar|appshell)/i.test(text);
}

function normalizeShellChromeCandidate(candidate) {
  if (!isShellChromeCandidate(candidate)) return candidate;
  const needsRouteRewrite = candidate.targetAppId === "desktop" || candidate.targetPath === "/desktop";
  const seedPlan = normalizeCaptureSeedPlan(candidate.seedPlan, {
    ...candidate,
    targetAppId: SHELL_CAPTURE_FALLBACK_APP_ID,
    targetPath: SHELL_CAPTURE_FALLBACK_PATH,
  });
  return {
    ...candidate,
    targetAppId: SHELL_CAPTURE_FALLBACK_APP_ID,
    targetPath: SHELL_CAPTURE_FALLBACK_PATH,
    reason: needsRouteRewrite
      ? [
        candidate.reason,
        `Shell/chrome captures are routed through ${SHELL_CAPTURE_FALLBACK_PATH} so the desktop frame is populated with visual product data instead of landing on an empty /desktop shell.`,
      ].filter(Boolean).join(" ")
      : candidate.reason,
    seedPlan: {
      ...seedPlan,
      capabilities: unique([
        ...seedPlan.capabilities,
        `app:${SHELL_CAPTURE_FALLBACK_APP_ID}`,
        "asset-gallery-populated",
        "image-gallery-populated",
        "project-selected",
        "proof-data-populated",
      ]),
      requiredState: unique([
        ...seedPlan.requiredState,
        "A populated AURA 3D project is open on the generated Image gallery surface so shell chrome, panels, and taskbar are visible around visual product content.",
      ]),
      readinessSignals: unique([
        ...seedPlan.readinessSignals,
        "AURA 3D app is active inside the desktop shell",
        "generated image preview and image gallery are visible",
        "bottom taskbar and sidekick are visible around visual product data",
        "desktop shell is populated, not empty",
      ]),
      avoid: unique([
        ...seedPlan.avoid,
        "empty /desktop launcher shell",
        "mostly black shell with only the Aura logo or topbar visible",
        "AURA 3D model tab showing only a placeholder/source image without gallery context",
      ]),
    },
  };
}

export function normalizeMediaPlan(plan, { maxCandidates = DEFAULT_MAX_CANDIDATES } = {}) {
  const normalizedCandidates = (Array.isArray(plan?.candidates) ? plan.candidates : [])
    .filter((candidate) => candidate?.shouldCapture === true)
    .map((candidate, index) => {
      const normalized = {
        entryId: normalizeString(candidate.entryId || `candidate-${index + 1}`),
        title: normalizeString(candidate.title),
        shouldCapture: true,
        reason: normalizeString(candidate.reason),
        targetAppId: normalizeString(candidate.targetAppId) || null,
        targetPath: normalizeString(candidate.targetPath) || null,
        proofGoal: normalizeString(candidate.proofGoal) || null,
        publicCaption: normalizeString(candidate.publicCaption) || null,
        confidence: clampConfidence(candidate.confidence),
        changedFiles: unique(candidate.changedFiles || []),
        seedPlan: normalizeCaptureSeedPlan(candidate.seedPlan, candidate),
      };
      return normalizeShellChromeCandidate(normalized);
    })
    .filter((candidate) => candidate.title && candidate.reason);

  const candidatesById = new Map();
  for (const candidate of normalizedCandidates) {
    const previous = candidatesById.get(candidate.entryId);
    if (!previous || candidate.confidence > previous.confidence) {
      candidatesById.set(candidate.entryId, candidate);
    }
  }
  const uniqueCandidates = [...candidatesById.values()];
  const eligibleCandidates = uniqueCandidates
    .filter((candidate) => candidate.confidence >= MIN_CAPTURE_CONFIDENCE && candidate.targetAppId && candidate.targetPath)
    .sort((left, right) => right.confidence - left.confidence || left.title.localeCompare(right.title));
  const candidates = eligibleCandidates.slice(0, maxCandidates);
  const selectedCandidateIds = new Set(candidates.map((candidate) => candidate.entryId));
  const candidateFallbackSkips = uniqueCandidates
    .filter((candidate) => !selectedCandidateIds.has(candidate.entryId))
    .map((candidate) => ({
      entryId: candidate.entryId,
      title: candidate.title,
      reason: !candidate.targetAppId || !candidate.targetPath
        ? "Planner did not provide a sitemap-backed target app and path."
        : candidate.confidence < MIN_CAPTURE_CONFIDENCE
        ? `Planner confidence ${candidate.confidence.toFixed(2)} is below the capture threshold.`
        : "Candidate was lower priority than the selected media budget.",
      category: !candidate.targetAppId || !candidate.targetPath || candidate.confidence < MIN_CAPTURE_CONFIDENCE ? "too-ambiguous" : "candidate-limit",
    }));

  const skipped = (Array.isArray(plan?.skipped) ? plan.skipped : [])
    .map((entry, index) => ({
      entryId: normalizeString(entry.entryId || `skipped-${index + 1}`),
      title: normalizeString(entry.title),
      reason: normalizeString(entry.reason),
      category: normalizeString(entry.category) || "too-ambiguous",
    }))
    .filter((entry) => entry.title && entry.reason);
  const skippedById = new Map();
  for (const entry of [...skipped, ...candidateFallbackSkips]) {
    if (!selectedCandidateIds.has(entry.entryId) && !skippedById.has(entry.entryId)) {
      skippedById.set(entry.entryId, entry);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidates,
    skipped: [...skippedById.values()],
  };
}

export function validateMediaPlanCoverage(plan, changelogEntries = []) {
  const expectedIds = new Set((Array.isArray(changelogEntries) ? changelogEntries : [])
    .map((entry) => normalizeString(entry.entryId))
    .filter(Boolean));
  const seen = new Map();
  for (const candidate of plan?.candidates || []) {
    seen.set(candidate.entryId, (seen.get(candidate.entryId) || 0) + 1);
  }
  for (const skipped of plan?.skipped || []) {
    seen.set(skipped.entryId, (seen.get(skipped.entryId) || 0) + 1);
  }
  const missing = [...expectedIds].filter((entryId) => !seen.has(entryId));
  const duplicate = [...seen.entries()]
    .filter(([entryId, count]) => expectedIds.has(entryId) && count > 1)
    .map(([entryId]) => entryId);
  const unknown = [...seen.keys()].filter((entryId) => !expectedIds.has(entryId));
  return {
    ok: missing.length === 0 && duplicate.length === 0 && unknown.length === 0,
    expectedCount: expectedIds.size,
    classifiedCount: [...seen.keys()].filter((entryId) => expectedIds.has(entryId)).length,
    missing,
    duplicate,
    unknown,
  };
}

function removeUnknownPlanEntries(plan, changelogEntries = []) {
  const expectedIds = new Set((Array.isArray(changelogEntries) ? changelogEntries : [])
    .map((entry) => normalizeString(entry.entryId))
    .filter(Boolean));
  return {
    ...plan,
    candidates: (plan?.candidates || []).filter((candidate) => expectedIds.has(normalizeString(candidate.entryId))),
    skipped: (plan?.skipped || []).filter((entry) => expectedIds.has(normalizeString(entry.entryId))),
  };
}

function completePlanCoverage(plan, changelogEntries = []) {
  const coverage = validateMediaPlanCoverage(plan, changelogEntries);
  if (coverage.missing.length === 0) {
    return {
      plan,
      forcedSkipped: [],
    };
  }
  const entriesById = new Map((Array.isArray(changelogEntries) ? changelogEntries : [])
    .map((entry) => [normalizeString(entry.entryId), entry]));
  const forcedSkipped = coverage.missing.map((entryId) => {
    const entry = entriesById.get(entryId);
    return {
      entryId,
      title: normalizeString(entry?.title) || entryId,
      reason: "Planner omitted this entry after retries, so it was safely skipped instead of being sent to Browser Use.",
      category: "too-ambiguous",
    };
  });
  return {
    plan: {
      ...plan,
      skipped: [...(plan?.skipped || []), ...forcedSkipped],
    },
    forcedSkipped,
  };
}

export function parseAnthropicMediaPlanResponse(response) {
  const toolUse = response?.content?.find((part) => part?.type === "tool_use" && part?.name === CHANGELOG_MEDIA_PLAN_TOOL.name);
  if (toolUse?.input) {
    return toolUse.input;
  }
  const text = response?.content
    ?.filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

function chunkArray(values, chunkSize) {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function mergePlans(plans, { maxCandidates = DEFAULT_MAX_CANDIDATES } = {}) {
  return normalizeMediaPlan({
    candidates: plans.flatMap((plan) => plan?.candidates || []),
    skipped: plans.flatMap((plan) => plan?.skipped || []),
  }, { maxCandidates });
}

function visualOpportunitiesForEntries(visualOpportunities = [], changelogEntries = []) {
  const entryIds = new Set((Array.isArray(changelogEntries) ? changelogEntries : [])
    .map((entry) => normalizeString(entry.entryId))
    .filter(Boolean));
  return (Array.isArray(visualOpportunities) ? visualOpportunities : [])
    .filter((opportunity) => entryIds.has(normalizeString(opportunity?.entryId)));
}

async function fetchWithTimeout(fetchImpl, url, options, { timeoutMs, label } = {}) {
  const resolvedTimeoutMs = Math.max(10, Number(timeoutMs) || DEFAULT_PLANNER_TIMEOUT_MS);
  const controller = new AbortController();
  let timeout = null;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label || "Anthropic media planning"} timed out after ${resolvedTimeoutMs}ms.`));
    }, resolvedTimeoutMs);
  });
  try {
    return await Promise.race([fetchImpl(url, {
      ...options,
      signal: options?.signal || controller.signal,
    }), timeoutPromise]);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label || "Anthropic media planning"} timed out after ${resolvedTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function planChangelogMediaChunkWithAnthropic({
  apiKey,
  model = "claude-opus-4-7",
  changelogEntries,
  sitemap,
  learnedKnowledge = null,
  commitLog = "",
  changedFiles = [],
  visualOpportunities = [],
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_PLANNER_TIMEOUT_MS,
  onProgress = null,
  chunkLabel = "",
} = {}) {
  const attempts = [];
  let retryInstruction = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = buildMediaPlannerPrompt({
      changelogEntries,
      sitemap,
      learnedKnowledge,
      commitLog,
      changedFiles,
      visualOpportunities,
      maxCandidates,
      retryInstruction: [
        chunkLabel ? `Planning chunk: ${chunkLabel}.` : "",
        retryInstruction,
      ].filter(Boolean).join("\n\n"),
    });
    onProgress?.({
      stage: "planner-attempt-start",
      chunkLabel,
      attempt,
      entryCount: changelogEntries.length,
    });
    const response = await fetchWithTimeout(fetchImpl, "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        tools: [CHANGELOG_MEDIA_PLAN_TOOL],
        tool_choice: { type: "tool", name: CHANGELOG_MEDIA_PLAN_TOOL.name },
        messages: [{ role: "user", content: prompt }],
      }),
    }, {
      timeoutMs,
      label: chunkLabel ? `Anthropic media planning (${chunkLabel}, attempt ${attempt})` : `Anthropic media planning attempt ${attempt}`,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic media planning failed with ${response.status}: ${body.slice(0, 500)}`);
    }
    const json = await response.json();
    const rawPlan = parseAnthropicMediaPlanResponse(json);
    if (!rawPlan) {
      throw new Error("Anthropic media planning did not return a media plan.");
    }
    const plan = removeUnknownPlanEntries(normalizeMediaPlan(rawPlan, { maxCandidates }), changelogEntries);
    const coverage = validateMediaPlanCoverage(plan, changelogEntries);
    attempts.push({ attempt, prompt, rawPlan, plan, coverage });
    onProgress?.({
      stage: "planner-attempt-complete",
      chunkLabel,
      attempt,
      candidateCount: plan.candidates.length,
      skippedCount: plan.skipped.length,
      coverage,
    });
    if (coverage.ok) {
      return {
        prompt,
        rawPlan,
        plan,
        coverage,
        attempts,
      };
    }
    retryInstruction = [
      "The previous output failed classification coverage.",
      `Missing entry IDs: ${coverage.missing.join(", ") || "none"}.`,
      `Duplicate entry IDs: ${coverage.duplicate.join(", ") || "none"}.`,
      `Unknown entry IDs: ${coverage.unknown.join(", ") || "none"}.`,
      "Return every provided entry ID exactly once in either candidates or skipped.",
      "Remember: mixed entries with a visible desktop feature should be candidates focused on that feature, not silently omitted.",
    ].join("\n");
  }
  const last = attempts.at(-1);
  return {
    prompt: last.prompt,
    rawPlan: last.rawPlan,
    plan: last.plan,
    coverage: last.coverage,
    attempts,
  };
}

export async function planChangelogMediaWithAnthropic({
  apiKey,
  model = "claude-opus-4-7",
  changelogEntries,
  sitemap,
  learnedKnowledge = null,
  commitLog = "",
  changedFiles = [],
  visualOpportunities = [],
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  entryChunkSize = DEFAULT_ENTRY_CHUNK_SIZE,
  timeoutMs = DEFAULT_PLANNER_TIMEOUT_MS,
  fetchImpl = fetch,
  onProgress = null,
} = {}) {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required to plan changelog media.");
  }
  const entries = Array.isArray(changelogEntries) ? changelogEntries : [];
  const chunkSize = Math.max(1, Number.parseInt(String(entryChunkSize || DEFAULT_ENTRY_CHUNK_SIZE), 10) || DEFAULT_ENTRY_CHUNK_SIZE);
  const chunks = chunkArray(entries, chunkSize);
  const chunkResults = [];

  for (const [index, chunk] of chunks.entries()) {
    const chunkLabel = chunks.length > 1 ? `${index + 1} of ${chunks.length}` : "";
    onProgress?.({
      stage: "planner-chunk-start",
      chunkLabel,
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      entryCount: chunk.length,
    });
    chunkResults.push(await planChangelogMediaChunkWithAnthropic({
      apiKey,
      model,
      changelogEntries: chunk,
      sitemap,
      learnedKnowledge,
      commitLog,
      changedFiles,
      visualOpportunities: visualOpportunitiesForEntries(visualOpportunities, chunk),
      maxCandidates,
      fetchImpl,
      timeoutMs,
      onProgress,
      chunkLabel,
    }));
    onProgress?.({
      stage: "planner-chunk-complete",
      chunkLabel,
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      candidateCount: chunkResults.at(-1)?.plan?.candidates?.length || 0,
      skippedCount: chunkResults.at(-1)?.plan?.skipped?.length || 0,
    });
  }

  let incompletePlan = mergePlans(chunkResults.map((result) => result.plan), { maxCandidates });
  let incompleteCoverage = validateMediaPlanCoverage(incompletePlan, entries);
  if (incompleteCoverage.missing.length > 0) {
    const entriesById = new Map(entries.map((entry) => [normalizeString(entry.entryId), entry]));
    const rescueEntries = incompleteCoverage.missing
      .map((entryId) => entriesById.get(entryId))
      .filter(Boolean);
    for (const [index, chunk] of chunkArray(rescueEntries, 5).entries()) {
      const chunkLabel = `rescue ${index + 1}`;
      onProgress?.({
        stage: "planner-rescue-start",
        chunkLabel,
        entryCount: chunk.length,
      });
      chunkResults.push(await planChangelogMediaChunkWithAnthropic({
        apiKey,
        model,
        changelogEntries: chunk,
        sitemap,
        learnedKnowledge,
        commitLog,
        changedFiles,
        visualOpportunities: visualOpportunitiesForEntries(visualOpportunities, chunk),
        maxCandidates,
        fetchImpl,
        timeoutMs,
        onProgress,
        chunkLabel,
      }));
      onProgress?.({
        stage: "planner-rescue-complete",
        chunkLabel,
        candidateCount: chunkResults.at(-1)?.plan?.candidates?.length || 0,
        skippedCount: chunkResults.at(-1)?.plan?.skipped?.length || 0,
      });
    }
    incompletePlan = mergePlans(chunkResults.map((result) => result.plan), { maxCandidates });
    incompleteCoverage = validateMediaPlanCoverage(incompletePlan, entries);
  }
  const completion = completePlanCoverage(incompletePlan, entries);
  const plan = completion.plan;
  const coverage = validateMediaPlanCoverage(plan, entries);
  const attempts = chunkResults.flatMap((result, chunkIndex) => result.attempts.map((attempt) => ({
    ...attempt,
    chunk: chunkIndex + 1,
  })));
  const prompt = chunkResults.map((result, index) => [
    chunks.length > 1 ? `# Chunk ${index + 1}` : "",
    result.prompt,
  ].filter(Boolean).join("\n\n")).join("\n\n---\n\n");
  const rawPlan = chunks.length > 1
    ? {
      chunks: chunkResults.map((result, index) => ({
        chunk: index + 1,
        rawPlan: result.rawPlan,
        coverage: result.coverage,
      })),
    }
    : chunkResults[0]?.rawPlan || { candidates: [], skipped: [] };

  return {
    prompt,
    rawPlan,
    plan,
    coverage,
    attempts,
    forcedSkipped: completion.forcedSkipped,
  };
}
