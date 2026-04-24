const DEFAULT_MAX_CANDIDATES = 3;
const MAX_PROMPT_CHARS = 52000;

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
            confidence: { type: "number", minimum: 0, maximum: 1 },
            changedFiles: { type: "array", items: { type: "string" } },
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
  }));
}

export function buildMediaPlannerPrompt({
  changelogEntries,
  sitemap,
  commitLog = "",
  changedFiles = [],
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  retryInstruction = "",
} = {}) {
  return [
    "You are the Aura changelog media planner.",
    "",
    "Your job is to decide which changelog entries deserve Browser Use desktop screenshot capture before any browser automation runs.",
    "",
    "Hard rules:",
    "- Every changelog entry must appear exactly once: either in candidates or in skipped.",
    "- If an entry mixes a visible desktop product feature with infra/release work, classify it by the visible desktop product feature and make the proofGoal focus only on that feature.",
    "- Return at most the requested number of candidates.",
    "- Candidate screenshots must be desktop web product UI only.",
    "- Skip mobile-only, native app, Android, iOS, backend-only, infra-only, release pipeline, dependency, test-only, docs-only, refactor-only, and invisible bug-fix changes.",
    "- Skip entries that are not meaningfully provable in one static desktop screenshot.",
    "- Prefer high-confidence product features that can be located from the generated sitemap and changed files.",
    "- Do not invent routes or product states that are not supported by the sitemap or commit context.",
    "- Browser Use should receive fewer, better candidates. Be conservative.",
    "",
    `Candidate limit: ${maxCandidates}`,
    "",
    "Generated Aura sitemap:",
    truncateText(JSON.stringify(sitemap || {}, null, 2)),
    "",
    "Changed files across release:",
    truncateText(JSON.stringify(unique(changedFiles, 160), null, 2), 12000),
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

export function normalizeMediaPlan(plan, { maxCandidates = DEFAULT_MAX_CANDIDATES } = {}) {
  const candidates = (Array.isArray(plan?.candidates) ? plan.candidates : [])
    .filter((candidate) => candidate?.shouldCapture === true)
    .map((candidate, index) => ({
      entryId: normalizeString(candidate.entryId || `candidate-${index + 1}`),
      title: normalizeString(candidate.title),
      shouldCapture: true,
      reason: normalizeString(candidate.reason),
      targetAppId: normalizeString(candidate.targetAppId) || null,
      targetPath: normalizeString(candidate.targetPath) || null,
      proofGoal: normalizeString(candidate.proofGoal) || null,
      confidence: clampConfidence(candidate.confidence),
      changedFiles: unique(candidate.changedFiles || []),
    }))
    .filter((candidate) => candidate.title && candidate.reason && candidate.confidence >= 0.55)
    .sort((left, right) => right.confidence - left.confidence || left.title.localeCompare(right.title))
    .slice(0, maxCandidates);

  const skipped = (Array.isArray(plan?.skipped) ? plan.skipped : [])
    .map((entry, index) => ({
      entryId: normalizeString(entry.entryId || `skipped-${index + 1}`),
      title: normalizeString(entry.title),
      reason: normalizeString(entry.reason),
      category: normalizeString(entry.category) || "too-ambiguous",
    }))
    .filter((entry) => entry.title && entry.reason);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidates,
    skipped,
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

export async function planChangelogMediaWithAnthropic({
  apiKey,
  model = "claude-opus-4-7",
  changelogEntries,
  sitemap,
  commitLog = "",
  changedFiles = [],
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required to plan changelog media.");
  }
  const attempts = [];
  let retryInstruction = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = buildMediaPlannerPrompt({
      changelogEntries,
      sitemap,
      commitLog,
      changedFiles,
      maxCandidates,
      retryInstruction,
    });
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
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
    const plan = normalizeMediaPlan(rawPlan, { maxCandidates });
    const coverage = validateMediaPlanCoverage(plan, changelogEntries);
    attempts.push({ attempt, prompt, rawPlan, plan, coverage });
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
