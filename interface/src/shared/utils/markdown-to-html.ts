/**
 * Markdown -> HTML serializer used to populate the `text/html` MIME type
 * on the system clipboard alongside the markdown source.
 *
 * Plumbing intentionally mirrors the `react-markdown` pipeline used by
 * `SegmentedContent` / `LargeTextBlock` (GFM tables, strikethrough, task
 * lists) so paste targets that consume `text/html` see the same shape
 * the user sees on screen. We deliberately skip syntax highlighting for
 * code fences -- paste targets like Notion / Google Docs / mail clients
 * do their own code styling, and shipping highlight.js classes would
 * just bloat the clipboard payload with classnames they don't honor.
 *
 * `processSync` is fine here because the unified pipeline is fully
 * synchronous (no async transformers in our plugin set) and copy is a
 * user-driven, infrequent action -- caching across calls is not worth
 * the complexity for the small markdown payloads we deal with.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { remarkWindowsPaths } from "./remark-windows-paths";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkWindowsPaths)
  .use(remarkRehype)
  .use(rehypeStringify);

export function markdownToHtml(markdown: string): string {
  if (!markdown) return "";
  try {
    return String(processor.processSync(markdown));
  } catch {
    return "";
  }
}
