import { useMemo, type ReactNode } from "react";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { FolderSection } from "../../../components/FolderSection";

export interface FeedbackFilterOption<TId extends string> {
  readonly id: TId;
  readonly label: string;
  readonly icon: ReactNode;
}

export interface FeedbackFilterTreeProps<TId extends string> {
  /** Label shown on the collapsible section header. */
  readonly label: string;
  /** The set of filter rows, in display order. */
  readonly options: ReadonlyArray<FeedbackFilterOption<TId>>;
  /** Whether the section is currently expanded. */
  readonly expanded: boolean;
  /** Fired when the user clicks the section header. */
  readonly onToggle: () => void;
  /** The id of the currently selected option. */
  readonly selectedId: TId;
  /** Fired with a known-id from `options` when the user picks a row. */
  readonly onSelect: (id: TId) => void;
}

/**
 * Presentational single-select filter list rendered inside a FolderSection.
 *
 * Wraps ZUI's Explorer so the FeedbackList orchestrator doesn't need to map
 * option arrays to ExplorerNodes itself, and so every filter section
 * (product / sort / category / status) shares the same look and
 * keyboard/selection behavior.
 */
export function FeedbackFilterTree<TId extends string>({
  label,
  options,
  expanded,
  onToggle,
  selectedId,
  onSelect,
}: FeedbackFilterTreeProps<TId>) {
  const data = useMemo<ExplorerNode[]>(
    () =>
      options.map((option) => ({
        id: option.id,
        label: option.label,
        icon: option.icon,
      })),
    [options],
  );
  const selectedIds = useMemo(() => [selectedId], [selectedId]);

  return (
    <FolderSection label={label} expanded={expanded} onToggle={onToggle}>
      <Explorer
        data={data}
        enableDragDrop={false}
        enableMultiSelect={false}
        defaultSelectedIds={selectedIds}
        onSelect={(ids) => {
          const next = ids[ids.length - 1];
          if (!next) return;
          const match = options.find((option) => option.id === next);
          if (match) onSelect(match.id);
        }}
      />
    </FolderSection>
  );
}
