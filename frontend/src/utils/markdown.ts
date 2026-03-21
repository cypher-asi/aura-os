import { Marked } from "marked";
import hljs from "highlight.js/lib/common";
import { useMemo } from "react";

const MAX_HIGHLIGHT_SIZE = 100_000;

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      if (text.length > MAX_HIGHLIGHT_SIZE) {
        return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>`;
      }
      try {
        const language = lang && hljs.getLanguage(lang) ? lang : undefined;
        const highlighted = language
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value;
        const cls = language ? `hljs language-${language}` : "hljs";
        return `<pre><code class="${cls}">${highlighted}</code></pre>`;
      } catch {
        return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>`;
      }
    },
  },
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderMarkdown(content: string): string {
  return marked.parse(content) as string;
}

export function useMarkdownHtml(content: string): string {
  return useMemo(() => renderMarkdown(content), [content]);
}
