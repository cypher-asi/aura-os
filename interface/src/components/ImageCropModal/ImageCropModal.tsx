import { useState, useCallback, useEffect } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Modal, Button } from "@cypher-asi/zui";
import { getCroppedImageDataUrl } from "../../utils/crop-image";
import styles from "./ImageCropModal.module.css";

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string;
  /** "round" for avatars, "rect" for banners etc. */
  cropShape?: "round" | "rect";
  /** Pixel dimensions of the output square image. */
  outputSize?: number;
  onConfirm: (dataUrl: string) => void;
  onClose: () => void;
  /** When provided, a "Change Image" button appears in the footer. */
  onChangeImage?: () => void;
}

export function ImageCropModal({
  isOpen,
  imageSrc,
  cropShape = "round",
  outputSize = 256,
  onConfirm,
  onClose,
  onChangeImage,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);

  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
  }, [imageSrc]);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedArea(croppedPixels);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!croppedArea) return;
    const dataUrl = await getCroppedImageDataUrl(imageSrc, croppedArea, outputSize);
    onConfirm(dataUrl);
    onClose();
  }, [croppedArea, imageSrc, outputSize, onConfirm, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Crop Image"
      size="md"
      footer={
        <div className={styles.footer}>
          <div>{onChangeImage && (
            <Button variant="ghost" onClick={onChangeImage}>
              Change Image
            </Button>
          )}</div>
          <div className={styles.footerEnd}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirm}>
              Confirm
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.cropContainer}>
        {imageSrc && (
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            minZoom={0.5}
            aspect={1}
            cropShape={cropShape}
            showGrid={false}
            restrictPosition={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        )}
      </div>
      <div className={styles.controls}>
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
      </div>
    </Modal>
  );
}
