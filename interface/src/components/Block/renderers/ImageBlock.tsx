import { Image as ImageIcon } from "lucide-react";
import type { ToolCallEntry } from "../../../shared/types/stream";
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

interface ImageBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function ImageBlock({ entry, defaultExpanded }: ImageBlockProps) {
  const data = parseResult(entry.result);
  const imageUrl = (data?.imageUrl ?? data?.url ?? data?.image_url) as string | undefined;
  const originalUrl = (data?.originalUrl ?? data?.original_url) as string | undefined;
  const model = (data as { meta?: { model?: string } } | null)?.meta?.model;
  const prompt =
    (data?.prompt as string | undefined) ??
    ((data as { meta?: { prompt?: string } } | null)?.meta?.prompt) ??
    (entry.input.prompt as string | undefined);

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";

  return (
    <Block
      icon={<ImageIcon size={12} />}
      title="Generated image"
      badge={model ?? "Image"}
      status={status}
      defaultExpanded={defaultExpanded ?? true}
    >
      <div className={styles.mediaWrap}>
        {imageUrl ? (
          <a href={originalUrl || imageUrl} target="_blank" rel="noopener noreferrer">
            <img src={imageUrl} alt={prompt ?? "Generated"} className={styles.mediaImage} />
          </a>
        ) : entry.pending ? (
          <div className={styles.listEmpty}>Generating…</div>
        ) : (
          <div className={styles.listEmpty}>No image returned.</div>
        )}
        {prompt ? <div className={styles.mediaCaption}>Prompt: {prompt}</div> : null}
      </div>
    </Block>
  );
}
