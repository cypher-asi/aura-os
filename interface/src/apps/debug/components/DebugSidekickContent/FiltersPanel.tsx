import { useShallow } from "zustand/react/shallow";
import { useDebugSidekickStore } from "../../stores/debug-sidekick-store";
import { DebugFilterMenu } from "../DebugFilterMenu";
import styles from "./DebugSidekickContent.module.css";

interface Props {
  types: string[];
}

/**
 * Event-type + free-text filter controls shown above each channel's
 * event list in the sidekick. We surface them here rather than in the
 * toolbar above the middle timeline so clicking a row can still show
 * the inspector without covering the filter controls.
 */
export function FiltersPanel({ types }: Props) {
  const { typeFilter, textFilter, setTypeFilter, setTextFilter } =
    useDebugSidekickStore(
      useShallow((s) => ({
        typeFilter: s.typeFilter,
        textFilter: s.textFilter,
        setTypeFilter: s.setTypeFilter,
        setTextFilter: s.setTextFilter,
      })),
    );

  const typeLabel = typeFilter
    ? typeFilter.length > 18
      ? `${typeFilter.slice(0, 18)}…`
      : typeFilter
    : "All types";

  const options = [
    { id: "", label: "All types" },
    ...types.map((type) => ({ id: type, label: type })),
  ];

  return (
    <div className={styles.filtersRow}>
      <DebugFilterMenu
        label={typeLabel}
        value={typeFilter}
        options={options}
        onChange={setTypeFilter}
        aria-label="Event type filter"
      />
      <input
        className={styles.textFilter}
        type="search"
        placeholder="Filter text"
        value={textFilter}
        onChange={(e) => setTextFilter(e.target.value)}
        aria-label="Text filter"
      />
    </div>
  );
}
