export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Convert plain multi-line text into a markdown bullet list.
 * Lines that are already list items or headings are left untouched.
 */
export function toBullets(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const trimmed = line.trimStart();
      if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed) || /^#/.test(trimmed)) {
        return line;
      }
      return `- ${trimmed}`;
    })
    .join("\n");
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
