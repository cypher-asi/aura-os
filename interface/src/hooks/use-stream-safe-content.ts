import { useMemo } from "react";

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

  safe = trimTrailingEmphasis(safe);
  safe = trimUnclosedCodeFence(safe);
  safe = trimUnclosedInlineCode(safe);
  safe = trimIncompleteLink(safe);
  safe = trimIncompleteHeading(safe);

  return safe;
}

function trimTrailingEmphasis(text: string): string {
  const trailingOpenMatch = /(^|[\s([{>])(\*{1,3}|_{1,3})(\S[\s\S]*)$/.exec(text);
  if (!trailingOpenMatch) return text;

  const prefix = trailingOpenMatch[1];
  const marker = trailingOpenMatch[2];
  const content = trailingOpenMatch[3];
  if (content.includes(marker)) {
    return text;
  }

  return text.slice(0, trailingOpenMatch.index) + prefix + content;
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

export function useStreamSafeContent(content: string, isStreaming: boolean): string {
  return useMemo(
    () => getStreamSafeContent(content, isStreaming),
    [content, isStreaming],
  );
}
