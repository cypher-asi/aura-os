const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token/i;
const LONG_SECRET = /(bearer\s+)?[a-z0-9_-]{32,}/gi;

export function redactSensitive(value, depth = 0) {
  if (depth > 8) return "[Max depth reached]";
  if (value == null) return value;
  if (typeof value === "string") {
    return truncate(value.replace(LONG_SECRET, (match) => {
      const bare = match.replace(/^bearer\s+/i, "");
      if (match.length < 32 || match.includes("/") || !/[0-9_]/.test(bare)) return match;
      return "[REDACTED]";
    }));
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((entry) => redactSensitive(entry, depth + 1));

  const output = {};
  for (const [key, entry] of Object.entries(value).slice(0, 80)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitive(entry, depth + 1);
  }
  return output;
}

function truncate(value) {
  if (value.length <= 5_000) return value;
  return `${value.slice(0, 5_000)}...[truncated ${value.length - 5_000} chars]`;
}
