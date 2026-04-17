import { Box } from "lucide-react";
import type { ToolCallEntry } from "../../../types/stream";
import { Block } from "../Block";
import styles from "./renderers.module.css";

function parseResult(result: string | null | undefined): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

interface Model3DBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function Model3DBlock({ entry, defaultExpanded }: Model3DBlockProps) {
  const data = parseResult(entry.result);
  const glbUrl = (data?.glbUrl ?? data?.glb_url) as string | undefined;
  const polyCount = data?.polyCount as number | undefined;
  const resultStatus = data?.status as string | undefined;

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";

  return (
    <Block
      icon={<Box size={12} />}
      title="Generated 3D model"
      badge={polyCount != null ? `${polyCount.toLocaleString()} polys` : "3D"}
      status={status}
      defaultExpanded={defaultExpanded ?? true}
    >
      <div className={styles.mediaWrap}>
        {glbUrl ? (
          <a href={glbUrl} target="_blank" rel="noopener noreferrer" className={styles.mediaLink}>
            Download GLB
          </a>
        ) : entry.pending ? (
          <div className={styles.listEmpty}>Generating…</div>
        ) : (
          <div className={styles.listEmpty}>No model returned.</div>
        )}
        {resultStatus && resultStatus !== "success" ? (
          <div className={styles.mediaCaption}>Status: {resultStatus}</div>
        ) : null}
      </div>
    </Block>
  );
}
