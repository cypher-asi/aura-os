export interface DiffSearchMatch {
  line: number;
  start: number;
  end: number;
}

export const MAX_DIFF_SEARCH_MATCHES = 1_000;

/** Literal, case-insensitive search with offsets into the original patch text. */
export function findDiffMatches(lines: readonly string[], query: string): {
  matches: DiffSearchMatch[];
  limited: boolean;
} {
  if (!query) return { matches: [], limited: false };
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const matches: DiffSearchMatch[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(lines[line])) !== null) {
      if (matches.length === MAX_DIFF_SEARCH_MATCHES) {
        return { matches, limited: true };
      }
      matches.push({ line, start: match.index, end: match.index + match[0].length });
    }
  }
  return { matches, limited: false };
}
