import { useState, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Text } from "@cypher-asi/zui";
import { Check } from "lucide-react";
import { useLogStream, EVENT_LABELS } from "../hooks/use-log-stream";
import { useClickOutside } from "../hooks/use-click-outside";
import { useSidekick } from "../context/SidekickContext";
import type { LogEntry } from "../hooks/use-log-stream";
import styles from "../components/Sidekick.module.css";

const TYPE_CATEGORY: Record<string, string> = {
  Loop: "loop",
  Task: "task",
  Output: "output",
  Files: "files",
  Session: "session",
  Log: "log",
  Spec: "spec",
};

const ALL_CATEGORIES = Object.keys(TYPE_CATEGORY);
const PRIMARY_CATEGORIES = ["Task", "Loop", "Spec", "Files"];
const MORE_CATEGORIES = ALL_CATEGORIES.filter((c) => !PRIMARY_CATEGORIES.includes(c));

function categoryClass(label: string): string {
  const cat = TYPE_CATEGORY[label] ?? "log";
  return styles[`logBadge_${cat}`] ?? styles.logBadge;
}

function chipClass(label: string, active: boolean): string {
  if (!active) return styles.logFilterChip;
  const cat = TYPE_CATEGORY[label] ?? "all";
  return styles[`logFilterChipActive_${cat}`] ?? styles.logFilterChip;
}

function LogFilterBar({
  active,
  onToggle,
  onToggleAll,
}: {
  active: Set<string>;
  onToggle: (category: string) => void;
  onToggleAll: () => void;
}) {
  const allActive = active.size === ALL_CATEGORIES.length;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, right: 0 });

  useClickOutside([moreRef, dropdownRef], () => setMoreOpen(false), moreOpen);

  const handleToggleMore = useCallback(() => {
    setMoreOpen((prev) => {
      if (!prev && moreRef.current) {
        const rect = moreRef.current.getBoundingClientRect();
        setPos({
          bottom: window.innerHeight - rect.top + 4,
          right: window.innerWidth - rect.right,
        });
      }
      return !prev;
    });
  }, []);

  return (
    <div className={styles.logFilterBar}>
      <button
        className={allActive ? styles.logFilterChipActive_all : styles.logFilterChip}
        onClick={onToggleAll}
      >
        All
      </button>
      {PRIMARY_CATEGORIES.map((cat) => (
        <button
          key={cat}
          className={chipClass(cat, active.has(cat))}
          onClick={() => onToggle(cat)}
        >
          {cat}
        </button>
      ))}
      <div ref={moreRef} className={styles.logFilterMore}>
        <button
          className={styles.logFilterChip}
          onClick={handleToggleMore}
        >
          More
        </button>
        {moreOpen && createPortal(
          <div
            ref={dropdownRef}
            className={styles.logFilterDropdown}
            style={{ position: "fixed", bottom: pos.bottom, right: pos.right }}
          >
            {MORE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={styles.logFilterDropdownItem}
                onClick={() => onToggle(cat)}
              >
                <span className={styles.logFilterDropdownCheck}>
                  {active.has(cat) && <Check size={12} />}
                </span>
                {cat}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

function LogRow({
  entry,
  onSelect,
}: {
  entry: LogEntry;
  onSelect: () => void;
}) {
  const label = EVENT_LABELS[entry.type] ?? "Event";
  return (
    <div
      className={styles.logRow}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
    >
      <span className={styles.logTimestamp}>{entry.timestamp}</span>
      <span className={`${styles.logBadge} ${categoryClass(label)}`}>{label}</span>
      <span className={styles.logSummary}>{entry.summary}</span>
    </div>
  );
}

export function SidekickLog({ searchQuery }: { searchQuery: string }) {
  const { entries, contentRef, handleScroll } = useLogStream();
  const sidekick = useSidekick();
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    () => new Set(ALL_CATEGORIES),
  );

  const toggleFilter = useCallback((category: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setActiveFilters((prev) =>
      prev.size === ALL_CATEGORIES.length ? new Set<string>() : new Set(ALL_CATEGORIES),
    );
  }, []);

  const filtered = useMemo(() => {
    let result = entries.filter((e) => activeFilters.has(EVENT_LABELS[e.type] ?? ""));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e) => e.summary.toLowerCase().includes(q));
    }
    return result;
  }, [entries, activeFilters, searchQuery]);

  return (
    <div className={styles.logWrap}>
      <LogFilterBar active={activeFilters} onToggle={toggleFilter} onToggleAll={toggleAll} />
      <div
        ref={contentRef}
        className={styles.logContent}
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className={styles.logEmpty}>
            <Text variant="muted" size="sm" style={{ textAlign: "center" }}>
              {entries.length === 0
                ? "Listening — events will appear when automation runs or specs are generated."
                : "No events match the current filters."}
            </Text>
          </div>
        ) : (
          filtered.map((entry, i) => (
            <LogRow
              key={i}
              entry={entry}
              onSelect={() => sidekick.pushPreview({ kind: "log", entry })}
            />
          ))
        )}
      </div>
    </div>
  );
}
