import { useCallback, useMemo } from "react";
import {
  availableModelsForAdapter,
  getModelsForMode,
  groupChatModelsByVendor,
  sortModelsForMenu,
  type GenerationMode,
  type ImageQuality,
  type ModelEffort,
  type ModelOption,
  type ModelVendorGroup,
} from "../../../constants/models";

export interface UseModelSelectionOptions {
  readonly streamKey: string;
  readonly adapterType?: string;
  readonly agentId?: string;
  readonly generationMode: GenerationMode;
  /** Store actions (referentially stable zustand actions). */
  readonly setSelectedModel: (
    streamKey: string,
    model: string,
    adapterType?: string,
    agentId?: string,
    effort?: ModelEffort,
  ) => void;
  readonly setImageQuality: (
    streamKey: string,
    quality: ImageQuality,
    agentId?: string,
  ) => void;
}

export interface ModelSelectionResult {
  /** Models offered for the active mode (chat: adapter-driven). */
  readonly modelsForMode: readonly ModelOption[];
  /** Flat, menu-ordered list for the non-condensed picker. */
  readonly sortedModelsForMode: readonly ModelOption[];
  /** Vendor-grouped sections for the condensed AURA picker. */
  readonly vendorGroups: readonly ModelVendorGroup[];
  /** Whether the condensed vendor-grouped menu applies. */
  readonly shouldUseCondensedAuraMenu: boolean;
  /** Pickers are inert when there is nothing to switch between. */
  readonly isModelPickerInteractive: boolean;
  readonly onModelChange: (model: string, effort?: ModelEffort) => void;
  readonly onImageQualityChange: (quality: ImageQuality) => void;
}

/**
 * Derives the model lists for the active generation mode and exposes
 * stable store-write callbacks. Pure data orchestration — picker UI
 * state (open menus, collapsed vendors) lives in `ModelControls`.
 */
export function useModelSelection({
  streamKey,
  adapterType,
  agentId,
  generationMode,
  setSelectedModel,
  setImageQuality,
}: UseModelSelectionOptions): ModelSelectionResult {
  // In chat mode, let the (only) `aura_harness` adapter drive the
  // available model list. In image/3d/video mode, use the mode-filtered
  // model list (generation is provider-agnostic today).
  const modelsForMode = useMemo(
    () =>
      generationMode === "chat"
        ? availableModelsForAdapter(adapterType)
        : getModelsForMode(generationMode),
    [generationMode, adapterType],
  );
  const sortedModelsForMode = useMemo(
    () => sortModelsForMenu(modelsForMode),
    [modelsForMode],
  );
  // Ordered, non-empty vendor sections (Anthropic / OpenAI / Open
  // Source today) for the collapsible chat picker.
  const vendorGroups = useMemo(
    () => groupChatModelsByVendor(modelsForMode),
    [modelsForMode],
  );
  const shouldUseCondensedAuraMenu =
    generationMode === "chat" &&
    (!adapterType || adapterType === "aura_harness");

  const onModelChange = useCallback(
    (model: string, effort?: ModelEffort) => {
      setSelectedModel(streamKey, model, adapterType, agentId, effort);
    },
    [setSelectedModel, streamKey, adapterType, agentId],
  );
  const onImageQualityChange = useCallback(
    (quality: ImageQuality) => {
      setImageQuality(streamKey, quality, agentId);
    },
    [setImageQuality, streamKey, agentId],
  );

  return {
    modelsForMode,
    sortedModelsForMode,
    vendorGroups,
    shouldUseCondensedAuraMenu,
    isModelPickerInteractive: modelsForMode.length > 1,
    onModelChange,
    onImageQualityChange,
  };
}
