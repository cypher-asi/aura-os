import { memo, useCallback, useState } from "react";
import {
  inputBarShellStyles,
  ModelPicker,
  ModelMenuRow,
  ModelMenuGroup,
  ModelMenuScroll,
  CouncilCountRow,
  SecondOpinionRow,
  CouncilMechanismRow,
} from "../../../../components/InputBarShell";
import {
  IMAGE_QUALITY_OPTIONS,
  modelLabelWithEffort,
  modelSupportsQuality,
  type GenerationMode,
  type ImageQuality,
  type ModelEffort,
  type ModelOption,
  type ModelVendor,
  type ModelVendorGroup,
} from "../../../../constants/models";
import type {
  AnswerStrategy,
  CouncilCount,
  CouncilMechanism,
  CouncilSlot,
} from "../../../../stores/chat-ui-store";
import styles from "./ModelControls.module.css";

export interface ModelControlsProps {
  /**
   * Where the controls render:
   * - `inline`: inside the shell's `inputRowEnd` slot, hugged to the
   *   send button (single-line prompt, no council, no chips).
   * - `bottom`: the bottom controls row (multi-line prompt, council
   *   fan-out, or command chips present).
   * - `mobileBar`: the shell's mobile "Model" row.
   */
  placement: "inline" | "bottom" | "mobileBar";
  streamKey: string;
  adapterType?: string;
  defaultModel?: string | null;
  generationMode: GenerationMode;
  selectedModel: string | null;
  selectedEffort: ModelEffort | null;
  imageQuality: ImageQuality;
  councilCount: CouncilCount;
  councilModels: readonly CouncilSlot[];
  councilMechanism: CouncilMechanism;
  answerStrategy: AnswerStrategy;
  secondOpinionReference: CouncilSlot | null;
  /** Store actions (referentially stable zustand actions). */
  setCouncilCount: (streamKey: string, count: CouncilCount) => void;
  setCouncilModel: (
    streamKey: string,
    slot: number,
    modelId: string,
    effort?: ModelEffort,
  ) => void;
  setCouncilMechanism: (
    streamKey: string,
    mechanism: CouncilMechanism,
  ) => void;
  setAnswerStrategy: (
    streamKey: string,
    strategy: AnswerStrategy,
    adapterType?: string,
    defaultModel?: string | null,
  ) => void;
  setSecondOpinionReference: (
    streamKey: string,
    modelId: string,
    effort?: ModelEffort,
  ) => void;
  /** Derived by `useModelSelection` in the orchestrator (memoized). */
  sortedModelsForMode: readonly ModelOption[];
  vendorGroups: readonly ModelVendorGroup[];
  shouldUseCondensedAuraMenu: boolean;
  isModelPickerInteractive: boolean;
  onModelChange: (model: string, effort?: ModelEffort) => void;
  onImageQualityChange: (quality: ImageQuality) => void;
}

/**
 * The model / image-quality / AURA Council picker cluster. Owns all
 * picker UI state (which dropdown is open, collapsed vendor sections)
 * so the orchestrating input bar never re-renders for menu
 * interactions — and, memoized with stable props, this whole cluster
 * skips re-rendering while the user types.
 */
export const ModelControls = memo(function ModelControls({
  placement,
  streamKey,
  adapterType,
  defaultModel,
  generationMode,
  selectedModel,
  selectedEffort,
  imageQuality,
  councilCount,
  councilModels,
  councilMechanism,
  answerStrategy,
  secondOpinionReference,
  setCouncilCount,
  setCouncilModel,
  setCouncilMechanism,
  setAnswerStrategy,
  setSecondOpinionReference,
  sortedModelsForMode,
  vendorGroups,
  shouldUseCondensedAuraMenu,
  isModelPickerInteractive,
  onModelChange,
  onImageQualityChange,
}: ModelControlsProps) {
  // Collapsed vendor sections in the condensed chat model picker.
  // Empty = all expanded (the default whenever the picker opens).
  const [collapsedVendors, setCollapsedVendors] = useState<Set<ModelVendor>>(
    () => new Set(),
  );
  // Which picker (model vs image-quality) is open. A single value keeps
  // the two dropdowns mutually exclusive so opening one closes the other.
  const [openPicker, setOpenPicker] = useState<"model" | "quality" | null>(
    null,
  );
  // Which AURA Council slot picker (if any) is open, so only one slot
  // menu is mounted at a time once the council fans out.
  const [openCouncilSlot, setOpenCouncilSlot] = useState<number | null>(null);
  const [openSecondOpinionReference, setOpenSecondOpinionReference] =
    useState(false);

  const toggleVendor = useCallback((vendor: ModelVendor) => {
    setCollapsedVendors((prev) => {
      const next = new Set(prev);
      if (next.has(vendor)) {
        next.delete(vendor);
      } else {
        next.add(vendor);
      }
      return next;
    });
  }, []);

  // Expand every vendor section each time the picker reopens, so a
  // user who collapsed sections last time still sees the full list.
  // `ModelPicker` itself keeps the caret focused in the textarea via
  // mousedown preventDefault, so we deliberately do NOT blur the
  // shell here — switching models should leave the user's typing
  // position intact.
  const handleModelPickerOpen = useCallback(() => {
    setCollapsedVendors(new Set());
  }, []);

  // Parametrized model-menu renderer shared by the single model picker
  // and the per-slot council pickers. `activeModelId` / `activeEffort`
  // drive the row highlight, `onSelect` writes the pick, and
  // `includeCouncilRow` prepends the AURA Council count row at the very
  // top of the menu (slot menus are single-select and must not recurse
  // the count row into themselves... but every slot still includes it
  // so the council control stays reachable from any selector).
  const renderModelMenuList = useCallback(
    (
      close: () => void,
      cfg: {
        activeModelId: string | null;
        activeEffort: ModelEffort | null;
        onSelect: (modelId: string, effort?: ModelEffort) => void;
        includeCouncilRow: boolean;
      },
    ) => {
      const councilRow = cfg.includeCouncilRow ? (
        <CouncilCountRow
          key="__council_count__"
          count={councilCount}
          onSelect={(n) => setCouncilCount(streamKey, n)}
        />
      ) : null;
      const secondOpinionActive =
        generationMode === "chat" && answerStrategy === "second_opinion";
      const referenceLabel =
        secondOpinionReference?.id != null
          ? modelLabelWithEffort(
              secondOpinionReference.id,
              secondOpinionReference.effort,
              adapterType,
              defaultModel,
            )
          : null;
      const secondOpinionRow =
        cfg.includeCouncilRow && generationMode === "chat" ? (
          <SecondOpinionRow
            key="__second_opinion__"
            active={secondOpinionActive}
            referenceLabel={referenceLabel}
            onToggle={(enabled) => {
              setAnswerStrategy(
                streamKey,
                enabled ? "second_opinion" : "single",
                adapterType,
                defaultModel,
              );
              close();
            }}
          />
        ) : null;
      // Combine-mechanism picker sits directly under the count row and
      // is only relevant once the council fans out (`count > 1`).
      const mechanismRow =
        cfg.includeCouncilRow && councilCount > 1 ? (
          <CouncilMechanismRow
            key="__council_mechanism__"
            mechanism={councilMechanism}
            onSelect={(m) => setCouncilMechanism(streamKey, m)}
          />
        ) : null;
      if (shouldUseCondensedAuraMenu) {
        return (
          <ModelMenuScroll
            lockWidth
            data-agent-surface="model-picker"
            data-agent-proof="chat-model-picker-visible"
          >
            {secondOpinionRow}
            {councilRow}
            {mechanismRow}
            {vendorGroups.map((group) => (
              <ModelMenuGroup
                key={group.vendor}
                label={group.label}
                collapsed={collapsedVendors.has(group.vendor)}
                onToggle={() => toggleVendor(group.vendor)}
              >
                {group.models.map((m) => (
                  <ModelMenuRow
                    key={m.id}
                    model={m}
                    isActive={m.id === cfg.activeModelId}
                    activeEffort={cfg.activeEffort}
                    onSelect={(id, effort) => {
                      cfg.onSelect(id, effort);
                      close();
                    }}
                  />
                ))}
              </ModelMenuGroup>
            ))}
          </ModelMenuScroll>
        );
      }
      return (
        <ModelMenuScroll
          data-agent-surface="model-picker"
          data-agent-proof="chat-model-picker-visible"
        >
          {secondOpinionRow}
          {councilRow}
          {mechanismRow}
          {sortedModelsForMode.map((m) => {
            const isComingSoon = m.id.startsWith("dreamina-seedance");
            return (
              <ModelMenuRow
                key={m.id}
                model={m}
                isActive={m.id === cfg.activeModelId}
                activeEffort={cfg.activeEffort}
                disabled={isComingSoon}
                labelSuffix={isComingSoon ? " (coming soon)" : undefined}
                onSelect={(id, effort) => {
                  cfg.onSelect(id, effort);
                  close();
                }}
              />
            );
          })}
        </ModelMenuScroll>
      );
    },
    [
      shouldUseCondensedAuraMenu,
      vendorGroups,
      collapsedVendors,
      toggleVendor,
      sortedModelsForMode,
      councilCount,
      setCouncilCount,
      councilMechanism,
      setCouncilMechanism,
      answerStrategy,
      secondOpinionReference,
      setAnswerStrategy,
      streamKey,
      generationMode,
      adapterType,
      defaultModel,
    ],
  );

  const renderModelMenuItems = useCallback(
    (close: () => void) =>
      renderModelMenuList(close, {
        activeModelId: selectedModel,
        activeEffort: selectedEffort,
        onSelect: (id, effort) => onModelChange(id, effort),
        includeCouncilRow: true,
      }),
    [renderModelMenuList, selectedModel, selectedEffort, onModelChange],
  );

  const renderQualityMenuItems = useCallback(
    (close: () => void) => (
      <div
        className={inputBarShellStyles.modelMenu}
        data-agent-surface="image-quality-picker"
        data-agent-proof="image-quality-picker-visible"
      >
        {IMAGE_QUALITY_OPTIONS.map((q) => (
          <button
            key={q.id}
            type="button"
            className={`${inputBarShellStyles.modelMenuItem} ${
              q.id === imageQuality
                ? inputBarShellStyles.modelMenuItemActive
                : ""
            }`}
            onClick={() => {
              onImageQualityChange(q.id);
              close();
            }}
          >
            <span className={inputBarShellStyles.modelMenuItemLabel}>
              {q.label}
            </span>
          </button>
        ))}
      </div>
    ),
    [imageQuality, onImageQualityChange],
  );

  const selectedLabel = modelLabelWithEffort(
    selectedModel ?? "",
    selectedEffort,
    adapterType,
    defaultModel,
  );

  if (placement === "mobileBar") {
    return (
      <div className={inputBarShellStyles.mobileModelBar}>
        <span className={inputBarShellStyles.mobileModelLabel}>Model</span>
        <ModelPicker
          selectedLabel={selectedLabel}
          isInteractive={isModelPickerInteractive}
          renderMenu={renderModelMenuItems}
          className={inputBarShellStyles.mobileModelMenuWrap}
          buttonClassName={inputBarShellStyles.mobileModelButton}
          showChevron={isModelPickerInteractive}
        />
      </div>
    );
  }

  const hasModels = sortedModelsForMode.length > 0;
  const modelPickerNode = hasModels ? (
    <ModelPicker
      selectedLabel={selectedLabel}
      isInteractive={isModelPickerInteractive}
      renderMenu={renderModelMenuItems}
      onOpen={handleModelPickerOpen}
      open={openPicker === "model"}
      onOpenChange={(o) => setOpenPicker(o ? "model" : null)}
      triggerProps={{ "data-agent-action": "open-model-picker" }}
      className={styles.inlineModelPicker}
    />
  ) : null;

  // Image-quality picker: only meaningful in Image mode for models that
  // expose a quality knob (GPT Image). Sits next to the model picker
  // and reuses the same dropdown chrome.
  const showQualityPicker =
    generationMode === "image" && modelSupportsQuality(selectedModel);
  const activeQualityLabel =
    IMAGE_QUALITY_OPTIONS.find((q) => q.id === imageQuality)?.label ??
    imageQuality;
  const qualityPickerNode = showQualityPicker ? (
    <ModelPicker
      selectedLabel={`Quality: ${activeQualityLabel}`}
      isInteractive
      renderMenu={renderQualityMenuItems}
      open={openPicker === "quality"}
      onOpenChange={(o) => setOpenPicker(o ? "quality" : null)}
      triggerProps={{ "data-agent-action": "open-quality-picker" }}
      className={styles.inlineModelPicker}
    />
  ) : null;

  if (placement === "inline") {
    return (
      <>
        {modelPickerNode}
        {qualityPickerNode}
      </>
    );
  }

  // Bottom controls row. When the council fans out (>1 member), one
  // ModelPicker per member, each bound to its own slot (slot 0 is the
  // synthesizer). Every slot reuses `renderModelMenuList` including the
  // council count row so the AURA Council control stays reachable from
  // any model selector once the council has fanned out.
  const councilActive = councilCount > 1;
  const secondOpinionActive =
    generationMode === "chat" && answerStrategy === "second_opinion" && !councilActive;
  const reference = secondOpinionReference ?? {
    id: selectedModel ?? "",
    effort: selectedEffort,
  };
  const secondOpinionSlotNodes = secondOpinionActive && hasModels ? (
    <>
      <div className={styles.secondOpinionSlot} data-second-opinion-slot="reference">
        <span className={styles.strategySlotLabel}>Reference</span>
        <ModelPicker
          selectedLabel={modelLabelWithEffort(
            reference.id,
            reference.effort,
            adapterType,
            defaultModel,
          )}
          isInteractive={isModelPickerInteractive}
          renderMenu={(close) =>
            renderModelMenuList(close, {
              activeModelId: reference.id,
              activeEffort: reference.effort,
              onSelect: (id, effort) =>
                setSecondOpinionReference(streamKey, id, effort),
              includeCouncilRow: false,
            })
          }
          onOpen={handleModelPickerOpen}
          open={openSecondOpinionReference}
          onOpenChange={setOpenSecondOpinionReference}
          triggerProps={{
            "data-agent-action": "open-second-opinion-reference",
          }}
          className={styles.inlineModelPicker}
        />
      </div>
      <div className={styles.secondOpinionSlot} data-second-opinion-slot="final">
        <span className={styles.strategySlotLabel}>Final</span>
        {modelPickerNode}
      </div>
    </>
  ) : null;
  const councilSlotNodes = councilActive && hasModels
    ? Array.from({ length: councilCount }, (_, slot) => {
        const member = councilModels[slot];
        const slotModelId = member?.id ?? selectedModel ?? "";
        const slotEffort = member?.effort ?? null;
        return (
          <div key={slot} className={styles.councilSlot}>
            <ModelPicker
              selectedLabel={modelLabelWithEffort(
                slotModelId,
                slotEffort,
                adapterType,
                defaultModel,
              )}
              isInteractive={isModelPickerInteractive}
              renderMenu={(close) =>
                renderModelMenuList(close, {
                  activeModelId: slotModelId,
                  activeEffort: slotEffort,
                  onSelect: (id, effort) =>
                    setCouncilModel(streamKey, slot, id, effort),
                  includeCouncilRow: true,
                })
              }
              onOpen={handleModelPickerOpen}
              open={openCouncilSlot === slot}
              onOpenChange={(o) => setOpenCouncilSlot(o ? slot : null)}
              triggerProps={{
                "data-agent-action": "open-council-slot",
                "data-council-slot": slot,
              }}
              className={styles.inlineModelPicker}
            />
          </div>
        );
      })
    : null;

  return (
    <div
      className={
        councilActive
          ? `${styles.bottomChromeRow} ${styles.councilSlotsRow}`
          : secondOpinionActive
            ? `${styles.bottomChromeRow} ${styles.secondOpinionSlotsRow}`
          : styles.bottomChromeRow
      }
      data-agent-surface={
        councilActive
          ? "council-slots"
          : secondOpinionActive
            ? "second-opinion-slots"
            : undefined
      }
    >
      {councilActive
        ? councilSlotNodes
        : secondOpinionActive
          ? secondOpinionSlotNodes
          : modelPickerNode}
      {qualityPickerNode}
    </div>
  );
});
