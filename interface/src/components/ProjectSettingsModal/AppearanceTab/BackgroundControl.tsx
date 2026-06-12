import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button, Input, Text } from "@cypher-asi/zui";
import type { ProjectAppearance } from "../../../shared/api/appearance";
import { ThemedSelect } from "./ThemedSelect";
import { ImageCropDialog, type ImageCropResult } from "./ImageCropDialog";
import styles from "./AppearanceTab.module.css";

/** True if `value` parses as a six-digit hex (with leading `#`).
 *  Matches the validator in `ColorPicker` so the freeform hex input
 *  for the background color behaves identically to the other color
 *  fields' hex inputs. */
function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

/**
 * Measure the live project background panel so the crop window matches
 * the space the image will actually fill (rather than a guessed ratio).
 * The frame stays mounted behind the settings modal, tagged with
 * `data-project-appearance-frame`. Falls back to 16:9 if it can't be
 * found. Output is capped at ~1600px on the longest edge — plenty for
 * the panel while staying well under the server's 5 MiB image cap.
 */
function measureBackgroundCrop(): {
  aspect: number;
  outputWidth: number;
  outputHeight: number;
} {
  let w = 1600;
  let h = 900;
  const el = document.querySelector<HTMLElement>(
    "[data-project-appearance-frame]",
  );
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width >= 1 && r.height >= 1) {
      w = r.width;
      h = r.height;
    }
  }
  const scale = 1600 / Math.max(w, h);
  return {
    aspect: w / h,
    outputWidth: Math.max(1, Math.round(w * scale)),
    outputHeight: Math.max(1, Math.round(h * scale)),
  };
}

type Pattern = NonNullable<NonNullable<ProjectAppearance["background"]>["pattern"]>;

const PATTERN_OPTIONS: { value: Pattern; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dots", label: "Dots" },
  { value: "grid", label: "Grid" },
  { value: "diagonal", label: "Diagonal lines" },
  { value: "noise", label: "Noise" },
  { value: "radial", label: "Radial gradient" },
  { value: "image", label: "Image" },
];

interface BackgroundControlProps {
  value: ProjectAppearance["background"];
  onChange: (next: ProjectAppearance["background"]) => void;
  /** Token-stamped GET URL for the project's uploaded background
   *  image, from `useProjectAppearance().backgroundImageUrl`. Used as
   *  the `<img src>` for the preview when `pattern === "image"`. */
  backgroundImageUrl: string;
  onUploadImage: (blob: Blob) => Promise<void>;
  onDeleteImage: () => Promise<void>;
}

/**
 * Background tint + pattern + opacity + optional uploaded image.
 * Writes through to the parent (which composes the partial into a
 * full appearance object before persisting), so individual fields can
 * be cleared by passing `undefined` without rebuilding the whole
 * object here. The Clear button at the section header wipes the
 * entire `background` block to revert to the Aura default.
 */
export function BackgroundControl({
  value,
  onChange,
  backgroundImageUrl,
  onUploadImage,
  onDeleteImage,
}: BackgroundControlProps) {
  const background = value ?? {};
  const color = background.color ?? "";
  // Legacy `none` reads through as `solid` so existing saves still
  // render under the new dropdown labels — the two are visually
  // identical (color-only, no overlay).
  const rawPattern = background.pattern ?? "solid";
  const pattern: Pattern = rawPattern === "none" ? "solid" : rawPattern;
  const opacity = typeof background.opacity === "number" ? background.opacity : 1;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasImage, setHasImage] = useState(true);
  const [removingImage, setRemovingImage] = useState(false);
  // Data URL of a freshly picked file, awaiting crop. Mirrors the
  // banner flow: pick → crop dialog → upload the cropped blob.
  const [pickedSrc, setPickedSrc] = useState<string | null>(null);
  // Crop aspect + output size, measured from the live background panel
  // at pick time so the crop window matches the real space.
  const [cropSpec, setCropSpec] = useState({
    aspect: 16 / 9,
    outputWidth: 1600,
    outputHeight: 900,
  });
  // Reset the "did this URL load?" probe whenever the cache-bust
  // version flips. Without this, an initial 404 (no image uploaded
  // yet) would unmount the `<img>` and a subsequent upload would never
  // get attempted. Mirrors the same pattern in `BannerControl`.
  useEffect(() => {
    setHasImage(true);
  }, [backgroundImageUrl]);

  const update = (next: ProjectAppearance["background"]) => {
    // Collapse to `undefined` when every nested field is empty so we
    // don't leave a `background: {}` ghost in the persisted JSON.
    if (
      !next ||
      (!next.color &&
        (!next.pattern || next.pattern === "solid" || next.pattern === "none") &&
        next.opacity == null)
    ) {
      onChange(undefined);
      return;
    }
    onChange(next);
  };

  const handleColor = (e: ChangeEvent<HTMLInputElement>) => {
    update({ ...background, color: e.target.value.toLowerCase() });
  };

  const handleHexInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (raw === "") {
      // Empty → treat as clear so the user can wipe the value by
      // selecting the field and deleting the text.
      const { color: _color, ...rest } = background;
      void _color;
      update(rest);
      return;
    }
    // Only commit on a valid hex so half-typed values don't poison
    // the live preview / server. The Input keeps showing whatever
    // the user typed until they finish.
    if (isValidHex(raw)) {
      update({ ...background, color: raw.toLowerCase() });
    }
  };

  const handleClearColor = () => {
    const { color: _color, ...rest } = background;
    void _color;
    update(rest);
  };

  const handlePattern = (next: Pattern) => {
    update({ ...background, pattern: next });
  };

  const handleOpacity = (e: ChangeEvent<HTMLInputElement>) => {
    const num = Number(e.target.value);
    update({ ...background, opacity: Number.isFinite(num) ? num : undefined });
  };

  const handleToggleInvert = () => {
    const next = !background.invert;
    // Store `true` explicitly; drop the key when off so the persisted
    // JSON stays minimal on the common path.
    if (next) {
      update({ ...background, invert: true });
    } else {
      const { invert: _, ...rest } = background;
      void _;
      update(rest);
    }
  };

  const handleToggleFrost = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      update({ ...background, frost: true });
    } else {
      // Drop both frost flags together so opting back in re-applies
      // the default amount instead of the user's last slider value
      // (which they might have dialed down to near-zero before
      // unchecking).
      const { frost: _f, frostAmount: _a, ...rest } = background;
      void _f;
      void _a;
      update(rest);
    }
  };

  const handleFrostAmount = (e: ChangeEvent<HTMLInputElement>) => {
    const num = Number(e.target.value);
    if (Number.isFinite(num)) {
      update({ ...background, frostAmount: num });
    }
  };

  const handlePatternSize = (e: ChangeEvent<HTMLInputElement>) => {
    const num = Number(e.target.value);
    if (Number.isFinite(num)) {
      update({ ...background, patternSize: num });
    }
  };

  const invert = background.invert === true;
  // Solid has nothing to invert; hide the toggle in that case so the
  // user isn't presented with a control that does nothing.
  const canInvert = pattern !== "solid";

  const frost = background.frost === true;
  const frostAmount =
    typeof background.frostAmount === "number" ? background.frostAmount : 8;

  // Size slider only makes sense for the tile-based patterns. Solid
  // has no shape; image uses `object-fit: cover` so any "size" is
  // just the container.
  const SCALABLE_PATTERNS: Pattern[] = [
    "dots",
    "grid",
    "diagonal",
    "noise",
    "radial",
  ];
  const canResize = SCALABLE_PATTERNS.includes(pattern);
  const patternSize =
    typeof background.patternSize === "number" ? background.patternSize : 1;

  // Hard reset: drop the entire `background` field. Also deletes the
  // uploaded image so the project genuinely reverts to the Aura
  // default and there's no orphaned `background.png` left behind in
  // `.aura/`.
  const handleClearBackground = () => {
    onChange(undefined);
    void onDeleteImage().catch((err) => {
      console.warn("Failed to delete background image on clear:", err);
    });
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      alert("Background image must be a PNG or JPEG.");
      return;
    }
    // Snapshot the live panel size so the crop window matches the
    // space the background will fill.
    setCropSpec(measureBackgroundCrop());
    // Read into a data URL and open the crop dialog rather than
    // uploading the raw file — same flow as the banner.
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPickedSrc(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleCropConfirm = async ({ blob }: ImageCropResult) => {
    // The background always renders with `object-fit: cover`, so the
    // scale-to-fit flag has no separate persisted field here — either
    // path just uploads the resulting blob.
    await onUploadImage(blob);
  };

  const closePicker = () => {
    setPickedSrc((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
  };

  // Re-open the crop dialog on the current background image so the user
  // can re-frame it (e.g. to a changed panel size) without re-picking.
  // Fetched into a same-origin object URL so the crop canvas isn't
  // tainted; re-measures the panel for the current aspect.
  const handleEditCrop = async () => {
    try {
      const res = await fetch(backgroundImageUrl);
      if (!res.ok) return;
      setCropSpec(measureBackgroundCrop());
      setPickedSrc(URL.createObjectURL(await res.blob()));
    } catch (err) {
      console.warn("Failed to load background image for crop:", err);
    }
  };

  const handleRemoveImage = async () => {
    setRemovingImage(true);
    try {
      await onDeleteImage();
    } finally {
      setRemovingImage(false);
    }
  };

  return (
    <div className={styles.controlGroup}>
      <div className={styles.iconHeader}>
        <Text variant="muted" size="sm" className={styles.sectionLabel}>
          Background
        </Text>
        <button
          type="button"
          className={styles.miniButton}
          onClick={handleClearBackground}
        >
          Clear
        </button>
      </div>

      <div className={styles.bgRow}>
        <span className={styles.bgRowLabel}>Color</span>
        <input
          type="color"
          value={color || "#1a1a1a"}
          onChange={handleColor}
          className={styles.nativeColorInput}
          aria-label="Pick background color"
        />
        <Input
          value={color}
          onChange={handleHexInput}
          placeholder="#1a1a1a"
        />
        {color && (
          <button
            type="button"
            className={styles.miniButton}
            onClick={handleClearColor}
          >
            Clear
          </button>
        )}
      </div>

      <div className={styles.bgRow}>
        <span className={styles.bgRowLabel}>Style</span>
        <ThemedSelect
          value={pattern}
          onChange={handlePattern}
          options={PATTERN_OPTIONS}
          ariaLabel="Background style"
        />
        {canInvert && (
          <button
            type="button"
            className={`${styles.miniButton} ${invert ? styles.miniButtonActive : ""}`}
            onClick={handleToggleInvert}
            title={
              pattern === "image" || pattern === "noise"
                ? "Invert image colors"
                : "Swap pattern figure/ground"
            }
            aria-pressed={invert}
          >
            Invert
          </button>
        )}
      </div>

      {canResize && (
        <div className={styles.bgRow}>
          <span className={styles.bgRowLabel}>Size</span>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.25}
            value={patternSize}
            onChange={handlePatternSize}
            className={styles.opacitySlider}
            aria-label="Pattern size"
          />
          <span className={styles.opacityValue}>
            {Math.round(patternSize * 100)}%
          </span>
        </div>
      )}

      {pattern === "image" && (
        <div className={styles.bgImageBlock}>
          <div className={styles.bgImagePreview}>
            {hasImage ? (
              <img
                src={backgroundImageUrl}
                alt="Project background"
                className={styles.bgImagePreviewImg}
                onError={() => setHasImage(false)}
                onLoad={() => setHasImage(true)}
              />
            ) : (
              <div className={styles.bannerEmpty}>No image uploaded</div>
            )}
          </div>
          <div className={styles.bannerActions}>
            <Button variant="secondary" onClick={openFilePicker}>
              {hasImage ? "Replace image" : "Upload image"}
            </Button>
            {hasImage && (
              <Button variant="ghost" onClick={handleEditCrop}>
                Crop
              </Button>
            )}
            {hasImage && (
              <Button
                variant="ghost"
                onClick={handleRemoveImage}
                disabled={removingImage}
              >
                {removingImage ? "Removing…" : "Remove image"}
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleFile}
              style={{ display: "none" }}
            />
          </div>
        </div>
      )}

      <div className={styles.bgRow}>
        <span className={styles.bgRowLabel}>Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={handleOpacity}
          className={styles.opacitySlider}
          aria-label="Background opacity"
        />
        <span className={styles.opacityValue}>{Math.round(opacity * 100)}%</span>
      </div>

      <div className={styles.bgRow}>
        <span className={styles.bgRowLabel}>Frost</span>
        <label className={styles.frostCheckLabel}>
          <input
            type="checkbox"
            checked={frost}
            onChange={handleToggleFrost}
          />
          <span>Frosted overlay</span>
        </label>
      </div>
      {frost && (
        <div className={styles.bgRow}>
          <span className={styles.bgRowLabel}>Amount</span>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={frostAmount}
            onChange={handleFrostAmount}
            className={styles.opacitySlider}
            aria-label="Frost amount"
          />
          <span className={styles.opacityValue}>{frostAmount}px</span>
        </div>
      )}

      {pickedSrc && (
        <ImageCropDialog
          isOpen
          imageSrc={pickedSrc}
          aspect={cropSpec.aspect}
          outputWidth={cropSpec.outputWidth}
          outputHeight={cropSpec.outputHeight}
          title="Crop background"
          saveLabel="Save background"
          onConfirm={handleCropConfirm}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
