import fs from "node:fs";
import path from "node:path";

const DEFAULT_KNOWLEDGE_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "knowledge",
  "changelog-media",
  "lessons.json",
);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLesson(lesson) {
  if (!lesson || typeof lesson !== "object") return null;
  const id = String(lesson.id || "").trim();
  if (!id) return null;
  return {
    id,
    status: String(lesson.status || "candidate").trim(),
    surface: String(lesson.surface || "").trim(),
    targetAppId: String(lesson.targetAppId || "").trim(),
    targetPath: String(lesson.targetPath || "").trim(),
    aliases: asArray(lesson.aliases).map(String).filter(Boolean),
    changedFileHints: asArray(lesson.changedFileHints).map(String).filter(Boolean),
    mediaSignals: asArray(lesson.mediaSignals).map(String).filter(Boolean),
    skipSignals: asArray(lesson.skipSignals).map(String).filter(Boolean),
    seedPlan: lesson.seedPlan && typeof lesson.seedPlan === "object" ? lesson.seedPlan : {},
    captureGuidance: asArray(lesson.captureGuidance).map(String).filter(Boolean),
    qualityGuidance: asArray(lesson.qualityGuidance).map(String).filter(Boolean),
    evidence: lesson.evidence && typeof lesson.evidence === "object" ? lesson.evidence : {},
  };
}

export function loadChangelogMediaKnowledge({
  filePath = DEFAULT_KNOWLEDGE_PATH,
  includeCandidates = false,
  maxLessons = 12,
} = {}) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      schemaVersion: 1,
      sourcePath: resolvedPath,
      curationPolicy: [],
      lessons: [],
    };
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const lessons = asArray(raw.lessons)
    .map(normalizeLesson)
    .filter(Boolean)
    .filter((lesson) => includeCandidates || lesson.status === "promoted")
    .slice(0, Math.max(0, maxLessons));

  return {
    schemaVersion: Number(raw.schemaVersion) || 1,
    sourcePath: resolvedPath,
    purpose: String(raw.purpose || "").trim(),
    curationPolicy: asArray(raw.curationPolicy).map(String).filter(Boolean),
    lessons,
  };
}

export function summarizeChangelogMediaKnowledge(knowledge) {
  const lessons = asArray(knowledge?.lessons);
  if (!lessons.length) return "";
  return [
    "Curated changelog media lessons:",
    JSON.stringify({
      policy: asArray(knowledge?.curationPolicy).slice(0, 6),
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        status: lesson.status,
        surface: lesson.surface,
        targetAppId: lesson.targetAppId,
        targetPath: lesson.targetPath,
        aliases: lesson.aliases,
        changedFileHints: lesson.changedFileHints,
        mediaSignals: lesson.mediaSignals,
        skipSignals: lesson.skipSignals,
        seedPlan: lesson.seedPlan,
        captureGuidance: lesson.captureGuidance,
        qualityGuidance: lesson.qualityGuidance,
        evidence: lesson.evidence,
      })),
    }, null, 2),
  ].join("\n");
}

