import { useRef, useCallback } from "react";
import { Modal, Heading, Button, Text } from "@cypher-asi/zui";
import { Upload } from "lucide-react";
import { useDesktopBackgroundStore } from "../../../stores/desktop-background-store";
import styles from "./BackgroundModal.module.css";

const PRESET_COLORS = [
  "#1a1a2e", "#16213e", "#0f3460", "#533483",
  "#2b2d42", "#3a0ca3", "#264653", "#2d6a4f",
  "#774936", "#6b2737", "#403d39", "#212529",
];

export function BackgroundModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const mode = useDesktopBackgroundStore((s) => s.mode);
  const color = useDesktopBackgroundStore((s) => s.color);
  const imageDataUrl = useDesktopBackgroundStore((s) => s.imageDataUrl);
  const setColor = useDesktopBackgroundStore((s) => s.setColor);
  const setImage = useDesktopBackgroundStore((s) => s.setImage);
  const clearBackground = useDesktopBackgroundStore((s) => s.clearBackground);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImage(reader.result);
        }
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [setImage],
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Desktop Background" size="sm">
      <div className={styles.content}>
        {/* Color section */}
        <div className={styles.section}>
          <Heading level={4}>Color</Heading>
          <div className={styles.swatches}>
            <button
              className={`${styles.swatch} ${styles.swatchDefault} ${mode === "none" ? styles.swatchActive : ""}`}
              onClick={() => clearBackground()}
              aria-label="Reset to default background"
            />
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                className={`${styles.swatch} ${mode === "color" && color === c ? styles.swatchActive : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
                aria-label={`Set background to ${c}`}
              />
            ))}
          </div>
          <div className={styles.customColorRow}>
            <input
              type="color"
              className={styles.colorInput}
              value={mode === "color" && color ? color : "#1a1a2e"}
              onChange={(e) => setColor(e.target.value)}
            />
            <Text variant="muted" size="sm">Custom color</Text>
          </div>
        </div>

        <div className={styles.divider} />

        {/* Image section */}
        <div className={styles.section}>
          <Heading level={4}>Image</Heading>
          {mode === "image" && imageDataUrl && (
            <img src={imageDataUrl} alt="Background preview" className={styles.imagePreview} />
          )}
          <div className={styles.imageActions}>
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload size={14} />}
              onClick={() => fileRef.current?.click()}
            >
              Choose Image
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFile}
          />
        </div>

      </div>
    </Modal>
  );
}
