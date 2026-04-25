import type { AnchorHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useStreamSafeContent } from "../../hooks/use-stream-safe-content";

/**
 * Markdown renderer for a segment of LLM prose.
 *
 * Historically this component also inlined `[tool: read(path) -> ok]` /
 * `[auto-build: ...]` markers as flat status rows. That path has been
 * replaced by `expandToolMarkersInTimeline` (see `utils/tool-markers.ts`),
 * which hoists markers out of the text timeline into real tool entries so
 * they render through the shared Block registry. Any marker that reaches
 * this component now means the timeline expansion failed to run, and the
 * marker will appear as literal text — intentional, so the upstream bug
 * surfaces instead of being silently re-styled as a stale pill.
 */

const MD_PLUGINS_REMARK = [remarkGfm];
const MD_PLUGINS_REHYPE = [rehypeHighlight];

function ExternalLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

const MD_COMPONENTS = { a: ExternalLink };

interface SegmentedContentProps {
  content: string;
  isStreaming?: boolean;
}

export function SegmentedContent({ content, isStreaming = false }: SegmentedContentProps) {
  const safeContent = useStreamSafeContent(content, isStreaming);
  return (
    <ReactMarkdown
      remarkPlugins={MD_PLUGINS_REMARK}
      rehypePlugins={MD_PLUGINS_REHYPE}
      components={MD_COMPONENTS}
    >
      {safeContent}
    </ReactMarkdown>
  );
}
