import { useRef, useEffect, useCallback, useState, memo } from "react";
import { filterCommands, type SlashCommand } from "../../../../constants/commands";
import styles from "./ChatInputBar.module.css";

interface Props {
  query: string;
  excludeIds: Set<string>;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export const SlashCommandMenu = memo(function SlashCommandMenu({
  query,
  excludeIds,
  onSelect,
  onClose,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = filterCommands(query, excludeIds);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector(
      `.${styles.slashMenuItemActive}`,
    ) as HTMLElement | null;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (filtered.length === 0) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopImmediatePropagation();
          setActiveIndex((i) => (i + 1) % filtered.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopImmediatePropagation();
          setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          e.stopImmediatePropagation();
          onSelect(filtered[activeIndex]);
          break;
        case "Escape":
          e.preventDefault();
          e.stopImmediatePropagation();
          onClose();
          break;
      }
    },
    [filtered, activeIndex, onSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  if (filtered.length === 0) return null;

  let lastCategory = "";

  return (
    <div className={styles.slashMenu} ref={listRef}>
      {filtered.map((cmd, i) => {
        const showCategory = cmd.category !== lastCategory;
        lastCategory = cmd.category;
        return (
          <div key={cmd.id}>
            {showCategory && (
              <div className={styles.slashMenuCategory}>{cmd.category}</div>
            )}
            <button
              type="button"
              className={`${styles.slashMenuItem} ${i === activeIndex ? styles.slashMenuItemActive : ""}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(cmd);
              }}
            >
              <span className={styles.slashMenuItemLabel}>{cmd.label}</span>
              <span className={styles.slashMenuItemDesc}>
                {cmd.description}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});
