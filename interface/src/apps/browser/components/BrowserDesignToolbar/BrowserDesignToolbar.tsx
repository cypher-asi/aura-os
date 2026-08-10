import {
  Expand,
  Monitor,
  MousePointer2,
  Smartphone,
  Tablet,
} from "lucide-react";
import {
  VIEWPORT_PRESETS,
  type BrowserMode,
  type ViewportPresetId,
} from "../../design-mode";
import styles from "./BrowserDesignToolbar.module.css";

export interface BrowserDesignToolbarProps {
  mode: BrowserMode;
  viewportPreset: ViewportPresetId;
  onModeChange: (mode: BrowserMode) => void;
  onViewportPresetChange: (preset: ViewportPresetId) => void;
}

const PRESET_ICONS = {
  fit: Expand,
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
} as const;

export function BrowserDesignToolbar({
  mode,
  viewportPreset,
  onModeChange,
  onViewportPresetChange,
}: BrowserDesignToolbarProps) {
  const activePreset = VIEWPORT_PRESETS.find(
    (item) => item.id === viewportPreset,
  );

  return (
    <div className={styles.root} data-testid="preview-design-toolbar">
      <div className={styles.modeGroup} role="group" aria-label="Preview mode">
        <button
          type="button"
          className={styles.modeButton}
          aria-pressed={mode === "preview"}
          onClick={() => onModeChange("preview")}
        >
          <Monitor size={13} aria-hidden="true" />
          <span>Preview</span>
        </button>
        <button
          type="button"
          className={styles.modeButton}
          aria-pressed={mode === "design"}
          onClick={() => onModeChange("design")}
        >
          <MousePointer2 size={13} aria-hidden="true" />
          <span>Design</span>
        </button>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <div
        className={styles.viewportGroup}
        role="group"
        aria-label="Preview viewport"
      >
        {VIEWPORT_PRESETS.map((preset) => {
          const Icon = PRESET_ICONS[preset.id];
          return (
            <button
              type="button"
              key={preset.id}
              className={styles.viewportButton}
              aria-label={preset.label}
              title={preset.label}
              aria-pressed={viewportPreset === preset.id}
              onClick={() => onViewportPresetChange(preset.id)}
            >
              <Icon size={13} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <span className={styles.dimensions} aria-live="polite">
        {activePreset?.width && activePreset.height
          ? `${activePreset.width} × ${activePreset.height}`
          : "Responsive"}
      </span>
    </div>
  );
}
