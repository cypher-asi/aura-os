/**
 * Split text into alternating prose / fenced-code segments so that
 * text-processing helpers can leave code blocks untouched.
 */
export function splitByCodeFences(text: string): { content: string; isCode: boolean }[] {
  const segments: { content: string; isCode: boolean }[] = [];
  const fenceRe = /^ {0,3}(`{3,}|~{3,})/gm;
  let cursor = 0;
  let insideCode = false;
  let openFenceChar = "";
  let openFenceLen = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(text)) !== null) {
    const fenceChar = match[1][0];
    const fenceLen = match[1].length;

    if (!insideCode) {
      if (match.index > cursor) {
        segments.push({ content: text.slice(cursor, match.index), isCode: false });
      }
      cursor = match.index;
      insideCode = true;
      openFenceChar = fenceChar;
      openFenceLen = fenceLen;
    } else if (fenceChar === openFenceChar && fenceLen >= openFenceLen) {
      const lineEnd = text.indexOf("\n", match.index);
      const blockEnd = lineEnd === -1 ? text.length : lineEnd + 1;
      segments.push({ content: text.slice(cursor, blockEnd), isCode: true });
      cursor = blockEnd;
      insideCode = false;
    }
  }

  if (cursor < text.length) {
    segments.push({ content: text.slice(cursor), isCode: insideCode });
  }

  return segments;
}

function splitByInlineCode(text: string): { content: string; isCode: boolean }[] {
  const segments: { content: string; isCode: boolean }[] = [];
  let cursor = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "`") {
      i++;
      continue;
    }

    let tickEnd = i + 1;
    while (tickEnd < text.length && text[tickEnd] === "`") tickEnd++;
    const delimiter = text.slice(i, tickEnd);
    const close = text.indexOf(delimiter, tickEnd);

    if (close === -1) {
      i = tickEnd;
      continue;
    }

    if (i > cursor) {
      segments.push({ content: text.slice(cursor, i), isCode: false });
    }
    segments.push({ content: text.slice(i, close + delimiter.length), isCode: true });
    cursor = close + delimiter.length;
    i = cursor;
  }

  if (cursor < text.length) {
    segments.push({ content: text.slice(cursor), isCode: false });
  }

  return segments;
}

export function stripEmojis(text: string): string {
  return splitByCodeFences(text)
    .map((seg) =>
      seg.isCode
        ? seg.content
        : seg.content
            .replace(/\p{Extended_Pictographic}/gu, "")
            .replace(/ {2,}/g, " "),
    )
    .join("");
}

/**
 * Normalize paragraph breaks in prose, preserving code blocks.
 *
 * Only collapses triple-newlines between GFM table rows into single
 * newlines (a known artefact from some LLM outputs). All other
 * double-newlines are preserved because they are significant for
 * markdown block structure (headings, lists, paragraphs).
 */
function normalizeProseBreaks(prose: string): string {
  return prose.replace(/\n\n+/g, (match, offset) => {
    const before = prose.slice(0, offset).split("\n");
    const after = prose.slice(offset + match.length).split("\n");

    const lastLine = before[before.length - 1]?.trim() ?? "";
    const nextLine = after.find((line) => line.trim().length > 0)?.trim() ?? "";

    const looksLikeTableRow = (line: string) => /^\|.+\|\s*$/.test(line);
    if (looksLikeTableRow(lastLine) && looksLikeTableRow(nextLine)) {
      return "\n";
    }

    return match;
  });
}

export function normalizeMidSentenceBreaks(text: string): string {
  return splitByCodeFences(text)
    .map((seg) => (seg.isCode ? seg.content : normalizeProseBreaks(seg.content)))
    .join("");
}

/**
 * Strip leading whitespace before list markers so the markdown parser
 * doesn't create unintended nested lists from inconsistent LLM indentation.
 */
export function flattenListIndentation(text: string): string {
  return splitByCodeFences(text)
    .map((seg) =>
      seg.isCode
        ? seg.content
        : seg.content.replace(/^[ \t]+([-*+]|\d+[.)]) /gm, "$1 "),
    )
    .join("");
}

const LOOSE_STRONG_EMPHASIS_RE = /(\*\*|__)([ \t]*)(\S[^\n]*?\S|\S)([ \t]*)(\1)/g;

/**
 * Repair common malformed strong emphasis from model output like
 * `** Overview**`, `__ title __`, or `**Title **` so markdown renders
 * as intended. CommonMark rejects emphasis whose closing marker is
 * preceded by whitespace (not a right-flanking delimiter run), so the
 * model's stray trailing space leaves the asterisks rendering literally.
 * Leaves well-formed `**bold**` spans and fenced/inline code untouched.
 */
export function normalizeLooseStrongEmphasis(text: string): string {
  return splitByCodeFences(text)
    .map((seg) => {
      if (seg.isCode) return seg.content;
      return splitByInlineCode(seg.content)
        .map((inlineSeg) =>
          inlineSeg.isCode
            ? inlineSeg.content
            : inlineSeg.content.replace(
                LOOSE_STRONG_EMPHASIS_RE,
                (match: string, marker: string, leadingWs: string, content: string, trailingWs: string, closing: string) =>
                  leadingWs.length > 0 || trailingWs.length > 0
                    ? `${marker}${content.trim()}${closing}`
                    : match,
              ),
        )
        .join("");
    })
    .join("");
}
