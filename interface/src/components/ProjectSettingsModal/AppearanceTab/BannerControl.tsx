import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { ImageCropDialog, type ImageCropResult } from "./ImageCropDialog";
import styles from "./AppearanceTab.module.css";

interface BannerControlProps {
  /** Current banner URL with cache-bust query param, from
   *  `useProjectAppearance().bannerUrl`. The `<img>` falls back to a
   *  "no banner" placeholder when the URL 404s. */
  bannerUrl: string;
  onUpload: (blob: Blob) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Persist the "scale to fit" flag on the appearance JSON so the
   *  rendering surfaces (`ProjectBannerStrip`, `ProjectBanner`) know
   *  to use `object-fit: contain` instead of `cover`. Called after
   *  the blob upload succeeds. */
  onSetScaleToFit: (scaleToFit: boolean) => void;
}

export function BannerControl({
  bannerUrl,
  onUpload,
  onDelete,
  onSetScaleToFit,
}: BannerControlProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickedSrc, setPickedSrc] = useState<string | null>(null);
  const [hasBanner, setHasBanner] = useState(true);
  const [removing, setRemoving] = useState(false);

  // Reset to "try again" whenever the URL changes (cache-bust on
  // upload/delete bumps the `?v=` query param). Without this, the
  // initial 404 on a project with no banner sticks at `hasBanner=false`,
  // the `<img>` unmounts entirely, and a subsequent upload never gets
  // a chance to render.
  useEffect(() => {
    setHasBanner(true);
  }, [bannerUrl]);

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always reset the input so re-picking the same file fires
    // another change event.
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      alert("Banner must be a PNG or JPEG image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPickedSrc(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = async ({ blob, scaleToFit }: ImageCropResult) => {
    await onUpload(blob);
    // Mirror the crop mode on the appearance JSON so the rendering
    // surfaces pick the right `object-fit` (cover vs contain). Sent
    // AFTER the blob upload so the optimistic appearance write
    // can't race ahead of the bytes that produced it.
    onSetScaleToFit(scaleToFit);
    // Force the preview to re-evaluate the new URL — the bannerUrl
    // already cache-busts on upload, but resetting the local error
    // state ensures the `<img>` re-renders.
    setHasBanner(true);
  };

  const closePicker = () => {
    setPickedSrc((prev) => {
      // Object URLs from the "re-crop current image" path must be
      // revoked; fresh-pick data URLs need no cleanup.
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
  };

  // Re-open the crop dialog on the *current* banner so the user can
  // re-frame it without re-picking the file. Fetched into a same-origin
  // object URL first — a cross-origin `<img>` would taint the crop
  // canvas and break `toBlob`. (Re-crops the stored image; the original
  // full-resolution source isn't retained server-side.)
  const handleEditCrop = async () => {
    try {
      const res = await fetch(bannerUrl);
      if (!res.ok) return;
      setPickedSrc(URL.createObjectURL(await res.blob()));
    } catch (err) {
      console.warn("Failed to load banner for crop:", err);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await onDelete();
      // No need to flip `hasBanner` here — the bannerVersion bump
      // changes `bannerUrl`, the useEffect above resets hasBanner to
      // true, the `<img>` tries the new URL, gets a 404, and onError
      // settles back to the empty state. Letting that flow happen
      // keeps the source of truth in one place.
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className={styles.controlGroup}>
      <div className={styles.iconHeader}>
        <Text variant="muted" size="sm" className={styles.sectionLabel}>
          Banner
        </Text>
      </div>

      <div className={styles.bannerPreview}>
        {hasBanner ? (
          // The same URL is the source of truth; an onError flips to
          // the placeholder branch so the "no banner" affordance shows
          // when the server has nothing to serve.
          <img
            src={bannerUrl}
            alt="Project banner"
            className={styles.bannerPreviewImg}
            onError={() => setHasBanner(false)}
            onLoad={() => setHasBanner(true)}
          />
        ) : (
          <div className={styles.bannerEmpty}>No banner set</div>
        )}
      </div>

      <div className={styles.bannerActions}>
        <Button variant="secondary" onClick={openFilePicker}>
          {hasBanner ? "Replace" : "Upload banner"}
        </Button>
        {hasBanner && (
          <Button variant="ghost" onClick={handleEditCrop}>
            Crop
          </Button>
        )}
        {hasBanner && (
          <Button
            variant="ghost"
            onClick={handleRemove}
            disabled={removing}
          >
            {removing ? "Removing…" : "Remove"}
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

      {pickedSrc && (
        <ImageCropDialog
          isOpen
          imageSrc={pickedSrc}
          aspect={16 / 5}
          outputWidth={1600}
          outputHeight={500}
          title="Crop banner"
          saveLabel="Save banner"
          onConfirm={handleConfirm}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
