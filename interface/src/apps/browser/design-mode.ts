export type BrowserMode = "preview" | "design";
export type ViewportPresetId = "fit" | "desktop" | "tablet" | "mobile";

export interface ViewportPreset {
  id: ViewportPresetId;
  label: string;
  width: number | null;
  height: number | null;
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { id: "fit", label: "Fit", width: null, height: null },
  { id: "desktop", label: "Desktop", width: 1440, height: 900 },
  { id: "tablet", label: "Tablet", width: 768, height: 1024 },
  { id: "mobile", label: "Mobile", width: 390, height: 844 },
];

export function getViewportPreset(id: ViewportPresetId): ViewportPreset {
  return (
    VIEWPORT_PRESETS.find((preset) => preset.id === id) ?? VIEWPORT_PRESETS[0]
  );
}
