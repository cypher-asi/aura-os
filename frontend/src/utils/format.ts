export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const LIST_OR_HEADING = /^(?:[-*+]\s|\d+\.\s|#)/;

/**
 * Convert plain text into a markdown bullet list, splitting paragraphs at
 * sentence boundaries so each distinct idea gets its own bullet.
 * Lines that are already list items or headings are left untouched.
 */
export function toBullets(text: string): string {
  const out: string[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (LIST_OR_HEADING.test(trimmed)) {
      const endsWithPunctuation = /[.!?:;)\]}>]$/.test(trimmed);
      out.push(endsWithPunctuation ? line : `${line.trimEnd()}.`);
      continue;
    }

    const sentences = trimmed.split(/(?<=\.)\s+(?=[A-Z])/);
    for (const s of sentences) {
      const clean = s.replace(/\.\s*$/, "").trim();
      if (clean.length > 0) out.push(`- ${clean}.`);
    }
  }

  return out.join("\n");
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

export function formatModelName(model: string): string {
  return model.replace(/^claude-/, "").replace(/-(\d)$/, " $1");
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
