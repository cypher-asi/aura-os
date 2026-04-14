const DEFAULT_PROJECT_AGENT_TITLE = "New Agent";
const MAX_WORDS = 5;
const MAX_LENGTH = 48;

const ACTION_WORDS = new Set([
  "add",
  "build",
  "create",
  "debug",
  "design",
  "draft",
  "explain",
  "explore",
  "fix",
  "implement",
  "investigate",
  "make",
  "plan",
  "refactor",
  "rename",
  "research",
  "review",
  "set",
  "ship",
  "update",
  "write",
]);

const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function stripLeadingPromptPhrases(value: string): string {
  return value
    .replace(/^\/\S+\s+/u, "")
    .replace(/^(please\s+)?(?:can|could|would|will)\s+you\s+/iu, "")
    .replace(/^(please\s+)?help\s+me\s+(?:to\s+)?/iu, "")
    .replace(/^(please\s+)?i\s+need\s+you\s+to\s+/iu, "")
    .replace(/^(please\s+)?let'?s\s+/iu, "")
    .trim();
}

function normalizeWord(value: string): string {
  return value.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

function toTitleWord(value: string, index: number): string {
  if (!value) {
    return value;
  }

  if (/^[A-Z0-9_-]+$/.test(value)) {
    return value;
  }

  const lower = value.toLowerCase();
  if (index > 0 && MINOR_WORDS.has(lower)) {
    return lower;
  }

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function deriveProjectAgentTitle(prompt: string): string {
  const firstLine = prompt
    .trim()
    .split(/\r?\n/u)
    .find((line) => line.trim().length > 0)
    ?.trim();

  if (!firstLine) {
    return DEFAULT_PROJECT_AGENT_TITLE;
  }

  const firstClause = stripLeadingPromptPhrases(firstLine)
    .replace(/https?:\/\/\S+/giu, " ")
    .split(/[.!?]/u)[0]
    ?.trim();

  if (!firstClause) {
    return DEFAULT_PROJECT_AGENT_TITLE;
  }

  const words = firstClause
    .split(/\s+/u)
    .map(normalizeWord)
    .filter(Boolean);

  if (words.length === 0) {
    return DEFAULT_PROJECT_AGENT_TITLE;
  }

  const summaryWords: string[] = [];
  const [firstWord, ...restWords] = words;
  const normalizedFirst = normalizeWord(firstWord);
  if (normalizedFirst) {
    summaryWords.push(normalizedFirst);
  }

  const preferAction = ACTION_WORDS.has(normalizedFirst.toLowerCase());
  for (const word of restWords) {
    const lower = word.toLowerCase();
    if (!preferAction && summaryWords.length === 0 && MINOR_WORDS.has(lower)) {
      continue;
    }
    if (summaryWords.length > 0 && MINOR_WORDS.has(lower)) {
      continue;
    }
    if (preferAction && summaryWords.length > 1 && ACTION_WORDS.has(lower)) {
      continue;
    }
    summaryWords.push(word);
    if (summaryWords.length >= MAX_WORDS) {
      break;
    }
  }

  const titled = summaryWords
    .map((word, index) => toTitleWord(word, index))
    .join(" ")
    .trim();

  if (!titled) {
    return DEFAULT_PROJECT_AGENT_TITLE;
  }

  return titled.length <= MAX_LENGTH
    ? titled
    : titled.slice(0, MAX_LENGTH).trimEnd();
}
