import { Image as ImageIcon } from "lucide-react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { Block } from "../Block";
import { useGallery } from "../../Gallery";
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
  const { openGallery } = useGallery();
  const data = parseResult(entry.result);
  const payload = data?.payload && typeof data.payload === "object"
    ? data.payload as Record<string, unknown>
    : null;
  const imageUrl = (
    data?.imageUrl ??
    data?.url ??
    data?.image_url ??
    data?.assetUrl ??
    data?.asset_url ??
    payload?.imageUrl ??
    payload?.url ??
    payload?.image_url ??
    payload?.assetUrl ??
    payload?.asset_url
  ) as string | undefined;
  const originalUrl = (
    data?.originalUrl ??
    data?.original_url ??
    payload?.originalUrl ??
    payload?.original_url
  ) as string | undefined;
  const model = (data as { meta?: { model?: string } } | null)?.meta?.model;
  const prompt =
    (data?.prompt as string | undefined) ??
    ((data as { meta?: { prompt?: string } } | null)?.meta?.prompt) ??
    (entry.input.prompt as string | undefined);

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";

  const openInGallery = (): void => {
    if (!imageUrl) return;
    openGallery({
      items: [
        {
          id: entry.id,
          src: imageUrl,
          alt: prompt ?? "Generated image",
          downloadUrl: originalUrl || imageUrl,
          caption: prompt,
        },
      ],
      initialId: entry.id,
    });
  };

  if (imageUrl && status === "done") {
    return (
      <div className={styles.generatedImageResult} data-agent-proof="generated-image-visible">
        <button
          type="button"
          className={styles.generatedImageLink}
          onClick={openInGallery}
          aria-label="Open generated image in gallery"
        >
          <img
            src={imageUrl}
            alt={prompt ?? "Generated image"}
            className={styles.generatedImage}
          />
        </button>
      </div>
    );
  }

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
          <button
            type="button"
            className={styles.mediaImageButton}
            onClick={openInGallery}
            aria-label="Open generated image in gallery"
          >
            <img src={imageUrl} alt={prompt ?? "Generated"} className={styles.mediaImage} />
          </button>
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
