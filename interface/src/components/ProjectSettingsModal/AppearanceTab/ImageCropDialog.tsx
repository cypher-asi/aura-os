import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button, Modal } from "@cypher-asi/zui";
import { cropImageToBlob } from "../../../shared/utils/crop-to-blob";
import styles from "./ImageCropDialog.module.css";

export interface ImageCropResult {
  blob: Blob;
  /** When true, the user opted out of cropping. The image was
   *  re-encoded at its native aspect; consumers that track a
   *  "scale to fit" flag (e.g. the banner) should mirror it so the
   *  rendering surface picks the right `object-fit`. */
  scaleToFit: boolean;
}

interface ImageCropDialogProps {
  isOpen: boolean;
  imageSrc: string;
  /** Crop aspect ratio (width / height) for the interactive cropper. */
  aspect: number;
  /** Fixed output resolution the cropped region is rendered to, so
   *  downstream layout stays predictable regardless of source size. */
  outputWidth: number;
  outputHeight: number;
  /** Modal title, e.g. "Crop banner" / "Crop background". */
  title: string;
  /** Primary button label, e.g. "Save banner" / "Save background". */
  saveLabel: string;
  onConfirm: (result: ImageCropResult) => Promise<void> | void;
  onClose: () => void;
}

/**
 * Re-encode the image at `imageSrc` as a PNG blob at its native aspect
 * (no crop), capping the longest edge so very large originals don't
 * bloat the upload. Backs the "scale to fit" path.
 */
async function reencodeForScaleToFit(imageSrc: string): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${imageSrc}`));
    img.src = imageSrc;
  });
  const MAX_EDGE = 2000;
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("failed to acquire 2d canvas context");
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
      "image/png",
    );
  });
}

/**
 * Reusable crop dialog: an interactive (react-easy-crop) cropper at a
 * fixed `aspect`, plus a "scale to fit" escape hatch that uploads the
 * source at its native aspect. Used by both the banner and the
 * project background-image flows, parameterised by aspect / output /
 * labels so each reads correctly for its field.
 */
export function ImageCropDialog({
  isOpen,
  imageSrc,
  aspect,
  outputWidth,
  outputHeight,
  title,
  saveLabel,
  onConfirm,
  onClose,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scaleToFit, setScaleToFit] = useState(false);

  // Reset every time a fresh image source loads so the previous
  // crop/zoom/mode doesn't bleed into a re-pick.
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    setError(null);
    setScaleToFit(false);
  }, [imageSrc]);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedArea(croppedPixels);
  }, []);

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const blob = scaleToFit
        ? await reencodeForScaleToFit(imageSrc)
        : croppedArea
          ? await cropImageToBlob(
              imageSrc,
              croppedArea,
              outputWidth,
              outputHeight,
              "image/png",
            )
          : null;
      if (!blob) {
        // Cropper hasn't reported a region yet; nothing to save.
        return;
      }
      await onConfirm({ blob, scaleToFit });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [croppedArea, imageSrc, outputWidth, outputHeight, onConfirm, onClose, scaleToFit]);

  const canConfirm = scaleToFit || !!croppedArea;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={saving || !canConfirm}
          >
            {saving ? "Saving…" : saveLabel}
          </Button>
        </div>
      }
    >
      <div className={styles.cropContainer}>
        {imageSrc && !scaleToFit && (
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            minZoom={0.5}
            aspect={aspect}
            cropShape="rect"
            showGrid={false}
            restrictPosition={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        )}
        {imageSrc && scaleToFit && (
          <img src={imageSrc} alt="Preview" className={styles.fitPreview} />
        )}
      </div>
      <div className={styles.controls}>
        <label className={styles.scaleToFitLabel}>
          <input
            type="checkbox"
            checked={scaleToFit}
            onChange={(e) => setScaleToFit(e.target.checked)}
          />
          <span>Scale to fit (no crop)</span>
        </label>
        {!scaleToFit && (
          <>
            <span className={styles.zoomLabel}>Zoom</span>
            <input
              type="range"
              className={styles.zoomSlider}
              min={0.5}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </>
        )}
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </Modal>
  );
}
