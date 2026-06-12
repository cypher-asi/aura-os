import { memo, useRef, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { inputBarShellStyles } from "../../../../components/InputBarShell";
import type { PinnedSourceImage } from "../../../../stores/chat-ui-store";
import styles from "./AttachControl.module.css";

export interface AttachControlProps {
  /**
   * 3D mode replaces the attach affordance with the pinned "Source for
   * 3D" thumb (manual attachments are not a valid 3D source today).
   */
  isThreeDMode: boolean;
  /** Pinned 3D source image, shown as an inline thumb in 3D mode. */
  pinnedSourceImage: PinnedSourceImage | null;
  onClearPinnedSource: () => void;
  /**
   * Static marketing mocks keep their decorative attach-accent well in
   * every mode so the left-side "+" area does not jump while the demo
   * cycles.
   */
  isStatic: boolean;
  /** Decorative WebGL well behind the "+" glyph (marketing mock only). */
  attachAccent?: ReactNode;
  canAttach: boolean;
  /** Receives the picked files from the native file dialog. */
  onFilesPicked: (files: FileList | null) => void;
}

/**
 * Start-of-row attach control: the "+" button plus its hidden file
 * input, or — in 3D mode — the pinned source-image thumb with its
 * remove affordance. Rendered in the shell's `inputRowStart` slot
 * (single-line: bottom-left corner; multi-line: bottom controls row).
 */
export const AttachControl = memo(function AttachControl({
  isThreeDMode,
  pinnedSourceImage,
  onClearPinnedSource,
  isStatic,
  attachAccent,
  canAttach,
  onFilesPicked,
}: AttachControlProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // In 3D mode the attach affordance is replaced by the auto-derived
  // "Source for 3D" thumb (rendered inline at the start of the input
  // row when an image is pinned). Keeping it inline — instead of
  // stacking it above the textarea — preserves the input row's height
  // so the pinned `ChatStreamingIndicator` ("Generating 3D model...")
  // remains visible.
  if (isThreeDMode && pinnedSourceImage != null) {
    return (
      <div
        className={`${inputBarShellStyles.attachButton} ${styles.sourceImageInline}`}
        data-agent-surface="chat-input-3d-source-thumb"
        data-agent-proof="3d-source-image-ready"
        title={pinnedSourceImage.prompt || "Source for 3D generation"}
      >
        <img
          className={styles.sourceImageInlineImg}
          src={pinnedSourceImage.imageUrl}
          alt={pinnedSourceImage.prompt || "Source for 3D generation"}
        />
        <button
          type="button"
          className={styles.sourceImageInlineRemove}
          onClick={onClearPinnedSource}
          aria-label="Remove source image"
        >
          <X size={9} />
        </button>
      </div>
    );
  }

  if (isThreeDMode && !(isStatic && attachAccent != null)) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className={
          attachAccent
            ? `${inputBarShellStyles.attachButton} ${styles.attachOrb}`
            : inputBarShellStyles.attachButton
        }
        onClick={() => fileInputRef.current?.click()}
        disabled={!canAttach}
        aria-label="Attach file"
      >
        {attachAccent ? (
          <span className={styles.attachOrbField} aria-hidden="true">
            {attachAccent}
          </span>
        ) : null}
        <Plus size={23} strokeWidth={1} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        multiple
        className={inputBarShellStyles.fileInputHidden}
        onChange={(e) => {
          onFilesPicked(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
});
