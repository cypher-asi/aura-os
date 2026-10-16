import { useEffect, type RefObject } from "react";
import { markdownToHtml } from "../utils/markdown-to-html";

/**
 * Attach a `copy` event handler that swaps the clipboard payload for a
 * markdown source string when the user's selection is fully contained
 * within (and covers all of the visible text in) `ref`.
 *
 * Why: rendering pipeline is `react-markdown` -> DOM, so the browser's
 * default copy behavior puts the *rendered* text on the clipboard --
 * `**bold**` becomes "bold", `# Heading` becomes "Heading", etc. That
 * round-trips terribly into Obsidian or any markdown editor. When we
 * still have the markdown source in hand (the assistant message
 * content, the spec body) we substitute it for `text/plain` and emit
 * the rendered HTML on `text/html` so rich editors stay happy.
 *
 * For partial selections we deliberately leave the browser default in
 * place -- we'd need an HTML->markdown converter to slice the source
 * accurately, which is intentionally deferred.
 */
export function useMarkdownCopy(
  ref: RefObject<HTMLElement | null>,
  getMarkdown: () => string,
): void {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const handler = (event: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }

      const selectedText = selection.toString();
      if (!selectedText) return;

      // UI chrome is not selectable source text. Work on a detached clone so
      // excluding code-block controls cannot mutate the visible transcript.
      let contentNode = node;
      if (node.querySelector("[data-markdown-copy-ignore]")) {
        contentNode = node.cloneNode(true) as HTMLElement;
        contentNode.querySelectorAll("[data-markdown-copy-ignore]").forEach((control) => control.remove());
      }
      const containerText = (contentNode.textContent ?? "").trim();
      if (!containerText) return;

      // Only override when the selection covers every renderable
      // character inside our container. Anything less and we fall
      // through to the browser default (which still includes a
      // text/html version of the slice).
      if (selectedText.trim() !== containerText) return;

      // And the selection must actually be *inside* this container --
      // a global "select all" that spills into siblings should keep
      // the default behavior.
      for (let i = 0; i < selection.rangeCount; i += 1) {
        const range = selection.getRangeAt(i);
        if (!node.contains(range.commonAncestorContainer)) return;
      }

      const md = getMarkdown();
      if (!md) return;

      event.preventDefault();
      const data = event.clipboardData;
      if (!data) return;
      data.setData("text/plain", md);
      data.setData("text/html", markdownToHtml(md));
    };

    node.addEventListener("copy", handler);
    return () => node.removeEventListener("copy", handler);
  }, [ref, getMarkdown]);
}
