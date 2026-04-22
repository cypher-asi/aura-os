import path from "node:path";
import { promises as fs } from "node:fs";

import { listDemoAgentApps } from "./demo-agent-app-catalog.mjs";
import { resolveDemoChangedFilePath } from "./demo-repo-paths.mjs";

function clipText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeArray(values, limit = 10) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

function tokenize(values) {
  return new Set(
    values
      .flatMap((value) => String(value || "").toLowerCase().split(/[^a-z0-9]+/g))
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function humanizeIdentifier(value) {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeInternalProofPhrase(value) {
  const text = String(value || "").trim();
  if (!text) {
    return true;
  }

  if (/[\\/]/.test(text) || /\.[cm]?[jt]sx?$/i.test(text) || /^data-agent-/i.test(text)) {
    return true;
  }

  if (/^(?:use|build|collect|resolve|normalize|apply)\b/i.test(text)) {
    return true;
  }

  if (
    /(?:store|cache|bootstrap|hydration|handler|handlers|hook|hooks|selector|selectors|state|query|queries|util|utils|runner|stream|event|events|fixture|fixtures|test|tests|spec|specs|module)$/i.test(text)
  ) {
    return true;
  }

  if (/^[a-z]+(?:[A-Z][a-z0-9]+){1,}$/.test(text)) {
    return true;
  }

  if (
    /\b(?:changed files|likely proof surface|relevant app surface|main panel is visible|visible and stable|changed-file evidence|desktop-only)\b/i.test(text)
  ) {
    return true;
  }

  return false;
}

function sanitizeVisibleProofPhrases(values, limit = 10) {
  return normalizeArray(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter((value) => value.length >= 2 && value.length <= 60)
      .filter((value) => !looksLikeInternalProofPhrase(value)),
    limit,
  );
}

function normalizeJsonCandidateText(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
}

function removeTrailingJsonCommas(value) {
  return String(value || "").replace(/,\s*([}\]])/g, "$1");
}

function extractBalancedBlock(value, openChar, closeChar) {
  const text = String(value || "");
  const start = text.indexOf(openChar);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function buildJsonParseCandidates(text) {
  const raw = normalizeJsonCandidateText(text);
  const candidates = [];
  const seen = new Set();
  const addCandidate = (value) => {
    const normalized = normalizeJsonCandidateText(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  addCandidate(raw);

  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)```/i);
  addCandidate(fenced?.[1]);

  const directObject = extractBalancedBlock(raw, "{", "}");
  addCandidate(directObject);

  const fencedObject = extractBalancedBlock(fenced?.[1] || "", "{", "}");
  addCandidate(fencedObject);

  const withLooseCommas = [...candidates];
  for (const candidate of withLooseCommas) {
    addCandidate(removeTrailingJsonCommas(candidate));
  }

  return candidates;
}

function extractLooseStringField(text, key) {
  const match = String(text || "").match(
    new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*,\\s*"|\\s*[,}\\]]|\\s*$)`, "i"),
  );
  if (!match?.[1]) {
    return null;
  }
  return match[1]
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .trim();
}

function extractLooseNullableStringField(text, key) {
  const normalized = String(text || "");
  const nullMatch = normalized.match(new RegExp(`"${key}"\\s*:\\s*null`, "i"));
  if (nullMatch) {
    return null;
  }
  return extractLooseStringField(normalized, key);
}

function extractLooseBooleanField(text, key) {
  const match = String(text || "").match(new RegExp(`"${key}"\\s*:\\s*(true|false)`, "i"));
  if (!match?.[1]) {
    return null;
  }
  return match[1].toLowerCase() === "true";
}

function extractLooseArrayBlock(text, key) {
  const normalized = String(text || "");
  const keyPattern = new RegExp(`"${key}"\\s*:`, "i");
  const keyMatch = keyPattern.exec(normalized);
  if (!keyMatch) {
    return null;
  }

  const remainder = normalized.slice(keyMatch.index + keyMatch[0].length);
  const arrayBlock = extractBalancedBlock(remainder, "[", "]");
  return arrayBlock;
}

function extractLooseStringArray(text, key, limit = 10) {
  const block = extractLooseArrayBlock(text, key);
  if (!block) {
    return [];
  }

  return normalizeArray(
    [...block.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((entry) =>
      entry[1]
        .replace(/\\"/g, "\"")
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .trim()
    ),
    limit,
  );
}

function extractLooseProofRequirements(text, limit = 6) {
  const block = extractLooseArrayBlock(text, "proofRequirements");
  if (!block) {
    return [];
  }

  return [...block.matchAll(/\{[\s\S]*?\}/g)]
    .map((entry) => {
      const chunk = entry[0];
      const label = extractLooseStringField(chunk, "label");
      const anyOf = extractLooseStringArray(chunk, "anyOf", 4);
      if (!label && anyOf.length === 0) {
        return null;
      }
      return {
        ...(label ? { label } : {}),
        anyOf,
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function salvageBriefCandidate(text) {
  const candidate = {
    title: extractLooseStringField(text, "title"),
    story: extractLooseStringField(text, "story"),
    targetAppId: extractLooseNullableStringField(text, "targetAppId"),
    confidence: extractLooseStringField(text, "confidence"),
    rationale: extractLooseStringField(text, "rationale"),
    successChecklist: extractLooseStringArray(text, "successChecklist", 6),
    setupPlan: extractLooseStringArray(text, "setupPlan", 6),
    systemPrompt: extractLooseStringField(text, "systemPrompt"),
    setupInstruction: extractLooseStringField(text, "setupInstruction"),
    openAppInstruction: extractLooseStringField(text, "openAppInstruction"),
    proofInstruction: extractLooseStringField(text, "proofInstruction"),
    validationSignals: extractLooseStringArray(text, "validationSignals", 8),
    proofRequirements: extractLooseProofRequirements(text, 6),
    requiredUiSignals: extractLooseStringArray(text, "requiredUiSignals", 4),
    forbiddenPhrases: extractLooseStringArray(text, "forbiddenPhrases", 6),
    validationInstruction: extractLooseStringField(text, "validationInstruction"),
    interactionInstruction: extractLooseStringField(text, "interactionInstruction"),
    desktopOnly: extractLooseBooleanField(text, "desktopOnly"),
    __salvaged: true,
  };

  const populatedKeys = Object.entries(candidate)
    .filter(([key, value]) => key !== "__salvaged" && (
      Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== ""
    ));

  return populatedKeys.length > 0 ? candidate : null;
}

function parseJsonCandidate(text) {
  for (const candidate of buildJsonParseCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Keep trying looser candidates before falling back to field salvage.
    }
  }

  const salvaged = salvageBriefCandidate(text);
  if (salvaged) {
    return salvaged;
  }

  throw new Error("Could not parse demo agent brief JSON payload");
}

function buildStoryText({ prompt, changelogDoc, changedFiles }) {
  if (prompt) {
    return clipText(prompt, 300);
  }

  const highlights = Array.isArray(changelogDoc?.rendered?.highlights)
    ? changelogDoc.rendered.highlights.slice(0, 4)
    : [];
  const fileHint = Array.isArray(changedFiles) && changedFiles.length > 0
    ? `Changed files: ${changedFiles.slice(0, 8).join(", ")}`
    : "";

  return [
    changelogDoc?.rendered?.title,
    changelogDoc?.rendered?.intro,
    highlights.join(" | "),
    fileHint,
  ].filter(Boolean).join(" ");
}

function extractStringMatches(source, pattern, limit = 12) {
  return normalizeArray(
    [...String(source || "").matchAll(pattern)].map((entry) => entry[1]),
    limit,
  );
}

function extractUiStrings(source) {
  return normalizeArray([
    ...extractStringMatches(source, /aria-label\s*=\s*"([^"]+)"/g, 8),
    ...extractStringMatches(source, /title\s*=\s*"([^"]+)"/g, 8),
    ...extractStringMatches(source, /placeholder\s*=\s*"([^"]+)"/g, 8),
    ...extractStringMatches(source, /\blabel:\s*"([^"]+)"/g, 8),
    ...extractStringMatches(source, /\btitle:\s*"([^"]+)"/g, 8),
  ], 12);
}

function extractDataAgentValues(source, fieldName, limit = 12) {
  return extractStringMatches(
    source,
    new RegExp(`${fieldName}\\s*=\\s*"([^"]+)"`, "g"),
    limit,
  );
}

function extractComponentNames(source) {
  return normalizeArray([
    ...extractStringMatches(source, /function\s+([A-Z][A-Za-z0-9]+)/g, 8),
    ...extractStringMatches(source, /const\s+([A-Z][A-Za-z0-9]+)\s*=\s*(?:memo\()?\(/g, 8),
  ], 10);
}

function extractRouteHints(source) {
  return normalizeArray(
    [...String(source || "").matchAll(/\/[a-z0-9_:/-]+/gi)].map((entry) => entry[0]),
    10,
  );
}

function describeSurfaceFromPath(filePath) {
  const baseName = path.basename(String(filePath || ""));
  const fileStem = baseName.replace(/\.[^.]+$/, "");

  const suffixMatchers = [
    ["SkillsTab", "Skills tab"],
    ["Tab", `${humanizeIdentifier(fileStem.replace(/Tab$/, ""))} tab`],
    ["Modal", `${humanizeIdentifier(fileStem.replace(/Modal$/, ""))} modal`],
    ["Panel", `${humanizeIdentifier(fileStem.replace(/Panel$/, ""))} panel`],
    ["Header", `${humanizeIdentifier(fileStem.replace(/Header$/, ""))} header`],
    ["List", `${humanizeIdentifier(fileStem.replace(/List$/, ""))} list`],
    ["Nav", `${humanizeIdentifier(fileStem.replace(/Nav$/, ""))} navigation`],
    ["View", `${humanizeIdentifier(fileStem.replace(/View$/, ""))} view`],
    ["Form", `${humanizeIdentifier(fileStem.replace(/Form$/, ""))} form`],
    ["Editor", `${humanizeIdentifier(fileStem.replace(/Editor$/, ""))} editor`],
    ["InputBar", `${humanizeIdentifier(fileStem.replace(/InputBar$/, ""))} input bar`],
  ];

  for (const [suffix, label] of suffixMatchers) {
    if (fileStem.endsWith(suffix)) {
      return label;
    }
  }

  return humanizeIdentifier(fileStem);
}

function extractPathAppHints(filePath, apps) {
  const normalizedPath = String(filePath || "").replace(/\\/g, "/").toLowerCase();
  return apps.filter((app) => normalizedPath.includes(`/apps/${app.id.toLowerCase()}/`)).map((app) => app.id);
}

function scoreAppFromEvidence(app, storyTerms, changedFiles, fileEvidence) {
  let score = 0;
  const matchedKeywords = [];
  const fileMatches = [];
  const surfaceMatches = [];

  for (const keyword of app.keywords ?? []) {
    if (storyTerms.has(String(keyword).toLowerCase())) {
      matchedKeywords.push(keyword);
      score += 3;
    }
  }

  for (const file of changedFiles ?? []) {
    const lowered = String(file).toLowerCase();
    if (lowered.includes(`/${app.id}/`) || lowered.includes(`/${app.label.toLowerCase()}/`)) {
      fileMatches.push(file);
      score += 6;
    }
  }

  for (const fileInfo of fileEvidence ?? []) {
    const match = (fileInfo.appMatches ?? []).find((entry) => entry.appId === app.id);
    if (!match) continue;
    score += match.score;
    fileMatches.push(fileInfo.filePath);
    if (fileInfo.surfaceLabel) {
      surfaceMatches.push(fileInfo.surfaceLabel);
    }
  }

  if (storyTerms.has(app.id)) {
    score += 5;
  }
  if (storyTerms.has(app.label.toLowerCase())) {
    score += 5;
  }

  return {
    app,
    score,
    matchedKeywords: normalizeArray(matchedKeywords, 8),
    fileMatches: normalizeArray(fileMatches, 6),
    surfaceMatches: normalizeArray(surfaceMatches, 6),
  };
}

function buildSystemPrompt() {
  return [
    "You are operating Aura in a seeded demo environment.",
    "Your job is to infer the most likely user-facing proof screen for the requested story from the changed files and then navigate there.",
    "Treat changed-file evidence as the primary signal and story text as secondary context.",
    "Use visible labels, aria-labels, routes, and data-agent-* attributes when they are present.",
    "Use visible controls, launchers, tabs, sidebars, and labeled rows as the first choice for navigation.",
    "Prefer reliable navigation over ambitious exploration.",
    "Never guess or hand-type routes that are not already visible in the UI.",
    "Never use direct URL navigation or typed routes to jump to a screen. Stay on the current origin and move through visible app controls.",
    "The automation runner disables direct goto navigation by default, so plan around visible UI only.",
    "If an interaction fails twice, stop and keep the clearest currently visible proof screen instead of exploring deeper.",
    "If you create a new agent, use a simple valid name such as AtlasDemoAgent. Agent names only support letters, numbers, hyphens, and underscores.",
    "Do not worry about real authentication or production-valid data.",
    "A generic empty state or selection prompt does not count as proof. If the UI asks you to select a project, row, item, or tab first, do that before stopping.",
    "If a flow is blocked, stop on the clearest visible screen that still proves the intended surface.",
  ].join(" ");
}

function buildPhaseInstructions({ story, targetApp, successChecklist, surfaceHints = [], fileEvidence = [] }) {
  const appInstruction = targetApp
    ? `Open the ${targetApp.label} app from the taskbar or any visible launcher. If it is already open, keep that app visible and stable instead of reopening it.`
    : "Find the app or shell surface that most likely matches the story.";
  const isAgentCreationStory = targetApp?.id === "agents" && /\b(create|new)\b/i.test(story) && /\bagent\b/i.test(story);
  const isSkillDeleteStory = targetApp?.id === "agents" && /\b(delete|remove)\b/i.test(story) && /\bskill\b/i.test(story);
  const surfaceInstruction = surfaceHints.length > 0
    ? `Changed files suggest these surfaces: ${surfaceHints.join("; ")}.`
    : null;
  const fileInstruction = fileEvidence.length > 0
    ? `Most relevant changed files: ${fileEvidence.join(", ")}.`
    : null;

  return {
    openAppInstruction: [
      appInstruction,
      surfaceInstruction,
      "Use app labels, routes, and data-agent metadata when helpful.",
      "Use visible controls only. Do not type URLs or rely on hidden navigation.",
      "A generic empty state or selection prompt is not proof. If the app asks you to select a project, row, item, or tab first, do that before stopping.",
      "Stop when the main panel for the relevant app is visible and stable.",
    ].filter(Boolean).join(" "),
    proofInstruction: [
      `Story to demonstrate: ${story}`,
      fileInstruction,
      surfaceInstruction,
      isAgentCreationStory
        ? "Create exactly one new agent named AtlasDemoAgent unless that agent already exists from the current run."
        : null,
      isSkillDeleteStory
        ? "If My Skills is empty, create exactly one simple demo skill first, then return to My Skills, open its actions menu, and click Delete so the confirmation dialog is visible."
        : null,
      "From the current screen, navigate to the clearest visible proof of that story.",
      "Prefer a screen with meaningful content over blank states.",
      "If the app asks you to select a project, record, task, or tab first, make one visible selection before stopping.",
      `Success checklist: ${successChecklist.join("; ")}.`,
      "Stop once the proof screen is visible and centered.",
    ].filter(Boolean).join(" "),
    interactionInstruction: [
      `Story to demonstrate: ${story}`,
      surfaceInstruction,
      isAgentCreationStory
        ? "If AtlasDemoAgent is already visible, keep that same agent selected and interact with its existing chat box or detail view. Do not open the create agent dialog again or create a second agent."
        : isSkillDeleteStory
          ? "If My Skills is empty, create one small demo skill first. The correct proof is the Delete skill confirmation dialog, not the Skill Shop or an empty My Skills state."
        : "If possible, perform one meaningful interaction that leaves a visible result on screen.",
      "Examples include opening a detail view, opening the most relevant tab, selecting a provider row, posting a comment, or switching to a relevant panel.",
      "Do not guess hidden routes or type manual URLs. Stay on visible, user-reachable surfaces only.",
      "Do not rely on direct URL navigation. Reach the proof state through the UI that a real desktop user can see.",
      "Generic empty states and selection prompts are not enough. If the app asks you to pick a project, item, or row first, do that before stopping.",
      "If two attempts to deepen the proof fail, stop and keep the best currently visible proof screen.",
      "If no safe interaction is available, keep the best proof screen visible.",
    ].filter(Boolean).join(" "),
  };
}

function buildSetupPlan({ story, targetApp, surfaceHints = [] }) {
  const loweredStory = String(story || "").toLowerCase();
  const setup = [];
  const isSkillDeleteStory = targetApp?.id === "agents" && /\b(delete|remove)\b/.test(loweredStory) && /\bskill\b/.test(loweredStory);

  if (targetApp?.label) {
    setup.push(`Open or keep the ${targetApp.label} app visible on the desktop shell.`);
  }

  const primarySurface = surfaceHints[0];
  if (primarySurface) {
    setup.push(`Navigate to the most relevant visible surface for this change, especially ${primarySurface}.`);
  }

  if (/\bsettings\b|\bmodal\b|\bdialog\b/i.test(loweredStory)) {
    setup.push("Open the relevant settings surface, modal, or dialog using visible controls only.");
  }

  if (/\btab\b|\bpermissions\b|\bskills\b|\bprojects\b|\btasks\b|\bmemory\b/i.test(loweredStory)) {
    setup.push("Select the most relevant tab or panel before attempting deeper interactions.");
  }

  if (/\bhover\b|\bpopover\b|\btooltip\b/i.test(loweredStory)) {
    setup.push("Trigger the hover or popover state and keep it visible during proof capture.");
  }

  if (/\bdelete\b|\bremove\b/i.test(loweredStory)) {
    setup.push(
      isSkillDeleteStory
        ? "If My Skills is empty, create exactly one demo skill first so the delete confirmation flow can be shown."
        : "If the target list is empty, create or reveal a single demo item first so the delete flow can be shown.",
    );
  }

  if (/\bcreate\b|\bnew\b/i.test(loweredStory)) {
    setup.push("If the proof depends on a new item existing, create exactly one demo item and keep it selected.");
  }

  setup.push("If the app shows a selection or empty-state prompt, make one visible selection before stopping.");

  return normalizeArray(setup, 6);
}

function buildValidationSignals({ story, targetApp, surfaceHints = [], successChecklist = [] }) {
  const loweredStory = String(story || "").toLowerCase();
  const storySignals = [];
  const isAgentCreationStory = targetApp?.id === "agents" && /\b(create|new)\b/i.test(loweredStory) && /\bagent\b/i.test(loweredStory);

  if (/\bdelete\b|\bremove\b/i.test(loweredStory)) {
    storySignals.push("Delete");
  }
  if (/\bcreate\b|\bnew\b/i.test(loweredStory)) {
    storySignals.push("Create");
  }
  if (/\bmodal\b|\bdialog\b/i.test(loweredStory)) {
    storySignals.push("Cancel");
  }
  if (/\bpopover\b|\btooltip\b|\bhover\b/i.test(loweredStory)) {
    storySignals.push("Context");
  }
  if (/\bpermission\b|\btools?\b/i.test(loweredStory)) {
    storySignals.push("Permissions");
  }
  if (isAgentCreationStory) {
    storySignals.push("AtlasDemoAgent");
    storySignals.push("is ready");
  }

  return sanitizeVisibleProofPhrases([
    targetApp?.label,
    ...storySignals,
    ...surfaceHints,
    ...successChecklist
      .flatMap((entry) => String(entry || "").split(/:|;|,|\bor\b/gi))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 4 && entry.length <= 48),
  ], 8);
}

function normalizeProofRequirements(requirements, limit = 6) {
  return (Array.isArray(requirements) ? requirements : [])
    .map((entry) => {
      if (Array.isArray(entry)) {
        const anyOf = sanitizeVisibleProofPhrases(entry, 4);
        if (anyOf.length === 0) return null;
        return {
          label: clipText(anyOf.join(" / "), 80),
          anyOf,
        };
      }
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const anyOf = sanitizeVisibleProofPhrases(entry.anyOf ?? entry.signals ?? [], 4);
      if (anyOf.length === 0) {
        return null;
      }
      return {
        label: clipText(
          sanitizeVisibleProofPhrases([entry.label], 1)[0] || anyOf.join(" / "),
          80,
        ),
        anyOf,
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function buildStoryProofRules({ story, targetApp, surfaceHints = [] }) {
  const loweredStory = String(story || "").toLowerCase();
  const isAgentCreationStory = targetApp?.id === "agents"
    && /\b(create|new)\b/i.test(loweredStory)
    && /\bagent\b/i.test(loweredStory);
  const proofRequirements = [];
  const requiredUiSignals = [];
  const forbiddenPhrases = [];
  const addRequirement = (label, anyOf) => {
    const normalized = normalizeArray(anyOf, 4);
    if (normalized.length === 0) {
      return;
    }
    proofRequirements.push({ label, anyOf: normalized });
  };

  if (targetApp?.id === "feedback" && /\bcomment(s)?\b|\bthread\b/i.test(loweredStory)) {
    requiredUiSignals.push("feedbackThreadVisible");
    forbiddenPhrases.push("Select a feedback item to view comments");
    forbiddenPhrases.push("No comments yet");
  }

  if (/\bdelete\b|\bremove\b/i.test(loweredStory) && /\bskill\b/i.test(loweredStory)) {
    addRequirement("delete skill modal", ["Delete skill"]);
    addRequirement("confirmation controls", ["Cancel", "Deleting..."]);
    addRequirement("danger action", ["Delete"]);
    forbiddenPhrases.push("No skills yet");
  }

  if (/\bpopover\b|\btooltip\b|\bhover\b/i.test(loweredStory)) {
    addRequirement("popover label", ["Context"]);
    addRequirement("usage detail", ["Used"]);
    addRequirement("capacity detail", ["Total"]);
  }

  if (/\bpermission\b/i.test(loweredStory) || surfaceHints.some((entry) => /permission/i.test(entry))) {
    addRequirement("permissions surface", ["Permissions"]);
  }

  if (/\bskills?\b/i.test(loweredStory) && !(/\bdelete\b|\bremove\b/i.test(loweredStory) && /\bskill\b/i.test(loweredStory))) {
    addRequirement("skills surface", ["Installed", "My Skills", "Available", "Skill Shop"]);
  }

  if (isAgentCreationStory) {
    addRequirement("created agent name", ["AtlasDemoAgent"]);
    addRequirement("created agent ready state", ["is ready"]);
  }

  if (/\bmodal\b|\bdialog\b/i.test(loweredStory) && !(/\bdelete\b|\bremove\b/i.test(loweredStory) && /\bskill\b/i.test(loweredStory))) {
    addRequirement("dialog controls", ["Cancel", "Close"]);
  }

  return {
    proofRequirements: normalizeProofRequirements(proofRequirements, 6),
    requiredUiSignals: normalizeArray(requiredUiSignals, 4),
    forbiddenPhrases: normalizeArray(forbiddenPhrases, 6),
  };
}

function buildValidationInstruction({ story, targetApp, surfaceHints = [], validationSignals = [] }) {
  const lines = [
    `Story to prove: ${story}`,
    targetApp ? `Stay within the ${targetApp.label} app unless it is clearly the wrong surface.` : null,
    surfaceHints.length > 0 ? `Focus on these likely surfaces: ${surfaceHints.join("; ")}.` : null,
    validationSignals.length > 0 ? `Visible proof signals to look for: ${validationSignals.join("; ")}.` : null,
    "Make the proof state visible, then verify it against those signals.",
    "A generic empty state or selection prompt does not count as proof. If the UI asks you to select a project, item, or row first, do that before stopping.",
    "If the proof is still missing, make at most one constrained correction using visible UI only.",
    "Do not switch into mobile mode, do not type hidden URLs, do not use direct URL jumps, and do not wander after the proof becomes visible.",
  ];
  return lines.filter(Boolean).join(" ");
}

async function analyzeChangedFile(filePath, apps) {
  const normalizedPath = String(filePath || "").trim().replace(/\\/g, "/");
  if (!normalizedPath) {
    return null;
  }

  const absolutePath = resolveDemoChangedFilePath(normalizedPath);
  const source = await fs.readFile(absolutePath, "utf8").catch(() => "");
  const uiStrings = extractUiStrings(source);
  const routeHints = extractRouteHints(source);
  const dataAgentSurfaces = extractDataAgentValues(source, "data-agent-surface", 8);
  const dataAgentActions = extractDataAgentValues(source, "data-agent-action", 8);
  const dataAgentFields = extractDataAgentValues(source, "data-agent-field", 8);
  const componentNames = extractComponentNames(source);
  const surfaceLabel = describeSurfaceFromPath(normalizedPath);
  const pathAppHints = extractPathAppHints(normalizedPath, apps);
  const sourceTokens = tokenize([
    normalizedPath,
    path.basename(normalizedPath),
    surfaceLabel,
    ...uiStrings,
    ...routeHints,
    ...dataAgentSurfaces,
    ...dataAgentActions,
    ...dataAgentFields,
    ...componentNames,
  ]);

  const appMatches = apps
    .map((app) => {
      let score = 0;
      const reasons = [];
      const keywordHits = [];

      if (pathAppHints.includes(app.id)) {
        score += 24;
        reasons.push("path-owned");
      }

      if (String(source || "").includes(`/apps/${app.id}/`)) {
        score += 12;
        reasons.push("imports-app");
      }

      if (routeHints.some((route) => route.startsWith(app.entryPath))) {
        score += 10;
        reasons.push("route-hint");
      }

      for (const keyword of app.keywords ?? []) {
        if (sourceTokens.has(String(keyword).toLowerCase())) {
          keywordHits.push(keyword);
          score += 2;
        }
      }

      if (uiStrings.some((entry) => entry.toLowerCase() === app.label.toLowerCase())) {
        score += 6;
        reasons.push("ui-label");
      }

      if (String(source || "").includes(`"${app.label}"`)) {
        score += 3;
        reasons.push("label-literal");
      }

      return {
        appId: app.id,
        score,
        reasons,
        keywordHits: normalizeArray(keywordHits, 6),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.appId.localeCompare(right.appId))
    .slice(0, 3);

  return {
    filePath: normalizedPath,
    surfaceLabel,
    uiStrings: uiStrings.slice(0, 8),
    routeHints: routeHints.slice(0, 6),
    dataAgentSurfaces,
    dataAgentActions,
    dataAgentFields,
    componentNames,
    appMatches,
  };
}

async function buildChangedFileEvidence(changedFiles, apps) {
  const fileEvidence = (
    await Promise.all(
      (Array.isArray(changedFiles) ? changedFiles : [])
        .slice(0, 12)
        .map((filePath) => analyzeChangedFile(filePath, apps)),
    )
  ).filter(Boolean);

  const appScoreMap = new Map();
  for (const fileInfo of fileEvidence) {
    for (const appMatch of fileInfo.appMatches ?? []) {
      const current = appScoreMap.get(appMatch.appId) ?? {
        appId: appMatch.appId,
        score: 0,
        files: [],
        surfaces: [],
      };
      current.score += appMatch.score;
      current.files.push(fileInfo.filePath);
      if (fileInfo.surfaceLabel) {
        current.surfaces.push(fileInfo.surfaceLabel);
      }
      appScoreMap.set(appMatch.appId, current);
    }
  }

  const rankedApps = Array.from(appScoreMap.values())
    .map((entry) => ({
      appId: entry.appId,
      score: entry.score,
      files: normalizeArray(entry.files, 6),
      surfaces: normalizeArray(entry.surfaces, 6),
    }))
    .sort((left, right) => right.score - left.score || left.appId.localeCompare(right.appId));

  return {
    files: fileEvidence,
    rankedApps,
  };
}

function buildSurfaceHints(targetAppId, changedFileEvidence) {
  const matchingFiles = (changedFileEvidence?.files ?? []).filter((fileInfo) =>
    (fileInfo.appMatches ?? []).some((entry) => entry.appId === targetAppId),
  );

  return sanitizeVisibleProofPhrases([
    ...matchingFiles.map((fileInfo) => fileInfo.surfaceLabel),
    ...matchingFiles.flatMap((fileInfo) => fileInfo.uiStrings),
  ], 8);
}

function fallbackBrief({ prompt, changelogDoc, changedFiles, apps, changedFileEvidence }) {
  const story = buildStoryText({ prompt, changelogDoc, changedFiles });
  const storyTerms = tokenize([story]);
  const scoredApps = apps
    .map((app) => scoreAppFromEvidence(app, storyTerms, changedFiles, changedFileEvidence?.files ?? []))
    .sort((left, right) => right.score - left.score || left.app.id.localeCompare(right.app.id));
  const best = scoredApps[0] ?? { app: apps[0], score: 0, matchedKeywords: [], fileMatches: [], surfaceMatches: [] };
  const targetApp = best.app ?? null;
  const confidence = best.score >= 24 ? "high" : best.score >= 10 ? "medium" : "low";
  const surfaceHints = buildSurfaceHints(targetApp?.id, changedFileEvidence);
  const successChecklist = normalizeArray([
    targetApp ? `${targetApp.label} app main panel is visible and stable` : "Relevant app surface is visible",
    ...(surfaceHints.length > 0 ? [`Likely proof surface is visible: ${surfaceHints[0]}`] : []),
    ...(best.surfaceMatches.length > 0 ? [`Changed files point to: ${best.surfaceMatches.slice(0, 2).join(", ")}`] : []),
    ...(Array.isArray(changelogDoc?.rendered?.highlights) ? changelogDoc.rendered.highlights.slice(0, 2) : []),
  ], 5);
  const phases = buildPhaseInstructions({
    story,
    targetApp,
    successChecklist,
    surfaceHints,
    fileEvidence: best.fileMatches,
  });
  const setupPlan = buildSetupPlan({
    story,
    targetApp,
    surfaceHints,
  });
  const validationSignals = buildValidationSignals({
    story,
    targetApp,
    surfaceHints,
    successChecklist,
  });
  const proofRules = buildStoryProofRules({
    story,
    targetApp,
    surfaceHints,
  });
  const validationInstruction = buildValidationInstruction({
    story,
    targetApp,
    surfaceHints,
    validationSignals,
  });

  return {
    title: clipText(prompt || changelogDoc?.rendered?.title || "Aura agent capture", 84),
    story: clipText(story, 320),
    targetAppId: targetApp?.id ?? null,
    targetAppLabel: targetApp?.label ?? null,
    startPath: targetApp?.entryPath ?? "/desktop",
    confidence,
    rationale: targetApp
      ? `Selected ${targetApp.label} from changed-file evidence${best.fileMatches.length > 0 ? ` (${best.fileMatches.slice(0, 3).join(", ")})` : ""}${best.surfaceMatches.length > 0 ? ` and likely proof surfaces (${best.surfaceMatches.slice(0, 3).join(", ")})` : ""}.`
      : "No strong app match was found, so the desktop shell will be explored first.",
    successChecklist,
    desktopOnly: true,
    setupPlan,
    systemPrompt: buildSystemPrompt(),
    setupInstruction: [
      phases.openAppInstruction,
      setupPlan.length > 0 ? `Setup plan: ${setupPlan.join(" ")}` : null,
      "This run is desktop-only. Do not try to switch to mobile shells or mobile-only layouts.",
    ].filter(Boolean).join(" "),
    openAppInstruction: phases.openAppInstruction,
    proofInstruction: phases.proofInstruction,
    validationSignals,
    proofRequirements: proofRules.proofRequirements,
    requiredUiSignals: proofRules.requiredUiSignals,
    forbiddenPhrases: proofRules.forbiddenPhrases,
    validationInstruction,
    interactionInstruction: phases.interactionInstruction,
    generator: "fallback",
    scoredApps: scoredApps.map((entry) => ({
      appId: entry.app.id,
      score: entry.score,
      matchedKeywords: entry.matchedKeywords,
      fileMatches: entry.fileMatches.slice(0, 5),
      surfaceMatches: entry.surfaceMatches.slice(0, 5),
    })),
    changedFileEvidence,
  };
}

function summarizeAppsForPrompt(apps) {
  return apps.map((app) => ({
    id: app.id,
    label: app.label,
    entryPath: app.entryPath,
    description: app.description,
    keywords: normalizeArray(app.keywords, 8),
    sourceContext: app.sourceContext ? {
      baseRouteKind: app.sourceContext.baseRouteKind,
      detailRouteKind: app.sourceContext.detailRouteKind,
      routeHints: normalizeArray(app.sourceContext.routeHints, 5),
      surfaces: normalizeArray(app.sourceContext.surfaces, 6),
      actions: normalizeArray(app.sourceContext.actions, 6),
      createLabels: normalizeArray(app.sourceContext.createLabels, 4),
    } : null,
  }));
}

function validateBrief(candidate, fallback, apps) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Demo agent brief must be an object");
  }

  const targetApp = apps.find((app) => app.id === candidate.targetAppId) ?? apps.find((app) => app.id === fallback.targetAppId) ?? null;
  const successChecklist = normalizeArray(candidate.successChecklist ?? fallback.successChecklist, 5);
  const surfaceHints = buildSurfaceHints(targetApp?.id, fallback.changedFileEvidence);
  const phases = buildPhaseInstructions({
    story: candidate.story || fallback.story,
    targetApp,
    successChecklist,
    surfaceHints,
    fileEvidence: fallback.scoredApps.find((entry) => entry.appId === targetApp?.id)?.fileMatches ?? [],
  });
  const setupPlan = normalizeArray(candidate.setupPlan ?? fallback.setupPlan, 6);
  const validationSignals = sanitizeVisibleProofPhrases(
    candidate.validationSignals ?? fallback.validationSignals,
    8,
  );
  const proofRules = buildStoryProofRules({
    story: candidate.story || fallback.story,
    targetApp,
    surfaceHints,
  });
  const proofRequirements = normalizeProofRequirements(
    candidate.proofRequirements
    ?? fallback.proofRequirements
    ?? proofRules.proofRequirements,
    6,
  );
  const requiredUiSignals = normalizeArray(
    candidate.requiredUiSignals
    ?? fallback.requiredUiSignals
    ?? proofRules.requiredUiSignals,
    4,
  );
  const forbiddenPhrases = normalizeArray(
    candidate.forbiddenPhrases
    ?? fallback.forbiddenPhrases
    ?? proofRules.forbiddenPhrases,
    6,
  );

  return {
    title: clipText(candidate.title || fallback.title, 84),
    story: clipText(candidate.story || fallback.story, 320),
    targetAppId: targetApp?.id ?? null,
    targetAppLabel: targetApp?.label ?? null,
    startPath: targetApp?.entryPath ?? fallback.startPath ?? "/desktop",
    confidence: ["high", "medium", "low"].includes(candidate.confidence) ? candidate.confidence : fallback.confidence,
    rationale: clipText(candidate.rationale || fallback.rationale, 220),
    successChecklist,
    desktopOnly: candidate.desktopOnly !== false,
    setupPlan,
    systemPrompt: clipText(candidate.systemPrompt || fallback.systemPrompt, 700),
    setupInstruction: clipText(
      candidate.setupInstruction
      || [
        phases.openAppInstruction,
        setupPlan.length > 0 ? `Setup plan: ${setupPlan.join(" ")}` : null,
        "This run is desktop-only. Do not try to switch to mobile shells or mobile-only layouts.",
      ].filter(Boolean).join(" "),
      700,
    ),
    openAppInstruction: clipText(candidate.openAppInstruction || phases.openAppInstruction, 600),
    proofInstruction: clipText(candidate.proofInstruction || phases.proofInstruction, 700),
    validationSignals,
    proofRequirements,
    requiredUiSignals,
    forbiddenPhrases,
    validationInstruction: clipText(
      candidate.validationInstruction || buildValidationInstruction({
        story: candidate.story || fallback.story,
        targetApp,
        surfaceHints,
        validationSignals,
      }),
      700,
    ),
    interactionInstruction: clipText(candidate.interactionInstruction || phases.interactionInstruction, 600),
    generator: candidate.__salvaged ? "anthropic-salvaged" : "anthropic",
    scoredApps: fallback.scoredApps,
    changedFileEvidence: fallback.changedFileEvidence,
  };
}

async function generateAnthropicBrief({ prompt, changelogDoc, changedFiles, apps, fallback }) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const model = process.env.AURA_DEMO_AGENT_BRIEF_MODEL?.trim() || "claude-sonnet-4-6";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      temperature: 0.1,
      messages: [{
        role: "user",
        content: [
          "Create an agent-first browser capture brief for Aura.",
          "Infer the target app and proof screen primarily from the changed-file evidence, not just the story text.",
          "This capture system is desktop-only. Do not propose mobile viewport or mobile-shell flows.",
          "The runner disables direct goto navigation. Plan around visible app controls, tabs, launchers, and labeled rows instead of URL jumps.",
          "Return JSON only with keys: title, story, targetAppId, confidence, rationale, successChecklist, setupPlan, systemPrompt, setupInstruction, openAppInstruction, proofInstruction, validationSignals, proofRequirements, requiredUiSignals, forbiddenPhrases, validationInstruction, interactionInstruction, desktopOnly.",
          "Only use a targetAppId from the supplied app catalog, or null if uncertain.",
          "Favor the clearest user-visible proof screen over generic app overviews.",
          "The setupPlan should explain how to reach the proof state without assuming a handcrafted scenario exists.",
          "The validationSignals should be short visible phrases or labels that should be on screen when the proof is correct.",
          "proofRequirements should be a small array of { label, anyOf } groups that must appear inside the proof crop for the screenshot to count as a correct feature proof.",
          "requiredUiSignals should be a short list of boolean UI states such as feedbackThreadVisible when the story depends on that surface being truly open.",
          "forbiddenPhrases should contain misleading placeholder text that would indicate the wrong proof state if visible.",
          "",
          "Story inputs:",
          JSON.stringify({
            prompt: prompt || null,
            changelog: changelogDoc ? {
              title: changelogDoc.rendered?.title,
              intro: changelogDoc.rendered?.intro,
              highlights: changelogDoc.rendered?.highlights ?? [],
            } : null,
            changedFiles: changedFiles ?? [],
          }, null, 2),
          "",
          "Changed-file evidence:",
          JSON.stringify(fallback.changedFileEvidence, null, 2),
          "",
          "Available apps (derived from source registry):",
          JSON.stringify(summarizeAppsForPrompt(apps), null, 2),
          "",
          "Deterministic fallback:",
          JSON.stringify(fallback, null, 2),
        ].join("\n"),
      }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic request failed (${response.status}): ${await response.text()}`);
  }

  const json = await response.json();
  const text = Array.isArray(json.content)
    ? json.content.filter((block) => block?.type === "text").map((block) => block.text).join("\n")
    : "";

  return validateBrief(parseJsonCandidate(text), fallback, apps);
}

export async function buildDemoAgentBrief({ prompt = "", changelogDoc = null, changedFiles = [] } = {}) {
  const apps = await listDemoAgentApps();
  const changedFileEvidence = await buildChangedFileEvidence(changedFiles, apps);
  const fallback = fallbackBrief({ prompt, changelogDoc, changedFiles, apps, changedFileEvidence });

  try {
    const generated = await generateAnthropicBrief({
      prompt,
      changelogDoc,
      changedFiles,
      apps,
      fallback,
    });
    if (generated) {
      return generated;
    }
  } catch (error) {
    return {
      ...fallback,
      generationError: error instanceof Error ? error.message : String(error),
    };
  }

  return fallback;
}

export {
  sanitizeVisibleProofPhrases,
};
