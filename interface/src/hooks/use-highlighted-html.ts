import { useMemo } from "react";
import hljs from "highlight.js/lib/common";

const MAX_HIGHLIGHT_SIZE = 100_000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function useHighlightedHtml(
  code: string,
  language?: string,
): string {
  return useMemo(() => {
    if (!code) return "";
    if (code.length > MAX_HIGHLIGHT_SIZE) return escapeHtml(code);
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return escapeHtml(code);
    }
  }, [code, language]);
}
