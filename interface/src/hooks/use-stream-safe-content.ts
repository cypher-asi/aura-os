import { useMemo } from "react";
import { splitByCodeFences } from "../utils/text-normalize";
import { trimIncompleteToolMarkerTail } from "../utils/tool-markers";

/**
 * Detects whether the tail of `text` contains an incomplete markdown
 * construct that would render as literal punctuation during streaming,
 * then flash into formatted output once the closing tokens arrive.
 *
 * Returns the content trimmed to the last "safe" point.
 * When `isStreaming` is false the full content is returned unchanged.
 */
export function getStreamSafeContent(text: string, isStreaming: boolean): string {
  if (!isStreaming || text.length === 0) return text;

  let safe = text;

  safe = trimUnclosedCodeFence(safe);
  safe = trimUnclosedInlineCode(safe);
  safe = trimIncompleteLink(safe);
  safe = trimIncompleteHeading(safe);
  safe = trimUnclosedEmphasis(safe);
  safe = trimLoneTrailingEmphasisMarkers(safe);
  safe = trimIncompleteToolMarkerTail(safe);

  return safe;
}

function trimUnclosedCodeFence(text: string): string {
  const lines = text.split("\n");
  let fenceOpen = false;
  let fenceChar = "";
  let fenceLen = 0;
  let fenceLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (!fenceMatch) continue;

    const ch = fenceMatch[1][0];
    const len = fenceMatch[1].length;

    if (!fenceOpen) {
      fenceOpen = true;
      fenceChar = ch;
      fenceLen = len;
      fenceLineIdx = i;
    } else if (ch === fenceChar && len >= fenceLen) {
      fenceOpen = false;
    }
  }

  if (fenceOpen && fenceLineIdx >= 0) {
    return lines.slice(0, fenceLineIdx).join("\n").trimEnd();
  }
  return text;
}

function trimUnclosedInlineCode(text: string): string {
  const lastLine = text.slice(text.lastIndexOf("\n") + 1);

  let i = lastLine.length - 1;
  let tickCount = 0;
  while (i >= 0 && lastLine[i] === "`") {
    tickCount++;
    i--;
  }

  if (tickCount === 0 || tickCount >= 3) return text;

  const delimiter = "`".repeat(tickCount);
  const beforeTrailing = lastLine.slice(0, i + 1);
  const openIdx = beforeTrailing.lastIndexOf(delimiter);
  if (openIdx === -1) {
    return text.slice(0, text.length - tickCount);
  }
  return text;
}

function trimIncompleteLink(text: string): string {
  const tail = text.slice(-200);

  const lastOpen = Math.max(tail.lastIndexOf("["), tail.lastIndexOf("!["));
  if (lastOpen === -1) return text;

  const afterOpen = tail.slice(lastOpen);
  if (!afterOpen.includes("]")) {
    const globalIdx = text.length - 200 + lastOpen;
    return text.slice(0, Math.max(0, globalIdx < 0 ? text.length + lastOpen - 200 : globalIdx));
  }
  return text;
}

function trimIncompleteHeading(text: string): string {
  const lastNl = text.lastIndexOf("\n");
  const lastLine = text.slice(lastNl + 1);

  if (/^#{1,6}\s*$/.test(lastLine)) {
    return text.slice(0, Math.max(0, lastNl));
  }
  return text;
}

/**
 * Inside prose (code-fence and inline-code aware), count each run of
 * `*`/`_` of a given length and if the count is odd treat the last run
 * as an unclosed opener and trim from that point on. Prevents raw
 * markers like `**`, `*foo`, or `_bar` from flashing while the closing
 * run is still in flight.
 */
function trimUnclosedEmphasis(text: string): string {
  return splitByCodeFences(text)
    .map((seg, idx, arr) => {
      if (seg.isCode) return seg.content;
      // Only the final prose segment needs tail repair; earlier prose
      // segments are already separated by a balanced code block so their
      // tail is a mid-text split, not a stream edge.
      const isTail = idx === arr.length - 1;
      if (!isTail) return seg.content;
      return trimUnclosedEmphasisInProse(seg.content);
    })
    .join("");
}

function trimUnclosedEmphasisInProse(prose: string): string {
  // Walk the prose segment, skipping inline code spans, and record every
  // emphasis marker run (`*`/`**`/`***`/`_`/`__`/`___`). If any marker
  // style has an odd number of runs, the final run is unclosed — trim
  // from its start.
  interface Run {
    marker: string;
    start: number;
    end: number;
  }
  const runs: Run[] = [];

  let i = 0;
  while (i < prose.length) {
    const ch = prose[i];
    if (ch === "`") {
      // Skip inline code span up to its matching close.
      let tickEnd = i + 1;
      while (tickEnd < prose.length && prose[tickEnd] === "`") tickEnd++;
      const delimiter = prose.slice(i, tickEnd);
      const close = prose.indexOf(delimiter, tickEnd);
      if (close === -1) {
        // Unclosed inline code; `trimUnclosedInlineCode` already handled
        // the simpler single-line case. Stop scanning here so we do not
        // mistake code-bound asterisks for emphasis markers.
        break;
      }
      i = close + delimiter.length;
      continue;
    }
    if (ch === "*" || ch === "_") {
      let runEnd = i + 1;
      while (runEnd < prose.length && prose[runEnd] === ch) runEnd++;
      const len = Math.min(runEnd - i, 3);
      runs.push({ marker: ch.repeat(len), start: i, end: i + len });
      i = runEnd;
      continue;
    }
    i++;
  }

  if (runs.length === 0) return prose;

  // Group runs by marker style and find the earliest unclosed opener.
  const countsByMarker = new Map<string, Run[]>();
  for (const run of runs) {
    const list = countsByMarker.get(run.marker) ?? [];
    list.push(run);
    countsByMarker.set(run.marker, list);
  }

  let earliestUnclosedStart = -1;
  for (const [, list] of countsByMarker) {
    if (list.length % 2 === 1) {
      const openerRun = list[list.length - 1];
      if (earliestUnclosedStart === -1 || openerRun.start < earliestUnclosedStart) {
        earliestUnclosedStart = openerRun.start;
      }
    }
  }

  if (earliestUnclosedStart === -1) return prose;

  // Drop the unclosed opener (and any trailing partial emphasis content).
  // Leaving the prefix preserves the already-rendered portion of the
  // stream, so word reveal does not appear to regress.
  return prose.slice(0, earliestUnclosedStart).replace(/\s+$/, "");
}

/**
 * If the buffer tail is a run of `*`/`_` preceded by whitespace (or the
 * start of the buffer), strip it. This catches the case where a lone
 * opener like "**" has arrived but its content has not, without touching
 * well-formed closing markers like the trailing `**` in `hello **world**`.
 */
function trimLoneTrailingEmphasisMarkers(text: string): string {
  return text.replace(/(^|\s)(\*{1,3}|_{1,3})\s*$/, "$1").replace(/\s+$/, "");
}

export function useStreamSafeContent(content: string, isStreaming: boolean): string {
  return useMemo(
    () => getStreamSafeContent(content, isStreaming),
    [content, isStreaming],
  );
}
