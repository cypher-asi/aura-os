import { useState, useEffect, useRef, useCallback } from "react";
import { Text } from "@cypher-asi/zui";
import { X } from "lucide-react";
import { cronApi } from "../../../api/cron";
import type { CronTag } from "../../../types";
import styles from "./TagSelector.module.css";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
}

export function TagSelector({ value, onChange }: Props) {
  const [tags, setTags] = useState<CronTag[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cronApi.listTags().then(setTags).catch(() => {});
  }, []);

  const filtered = tags.filter(
    (t) =>
      t.name.toLowerCase().includes(query.toLowerCase()) &&
      !value.includes(t.name),
  );

  const exactMatch = tags.some(
    (t) => t.name.toLowerCase() === query.trim().toLowerCase(),
  );

  const alreadySelected = value.some(
    (v) => v.toLowerCase() === query.trim().toLowerCase(),
  );

  const handleSelect = useCallback(
    (name: string) => {
      if (!value.includes(name)) {
        onChange([...value, name]);
      }
      setQuery("");
      setOpen(false);
    },
    [value, onChange],
  );

  const handleRemove = useCallback(
    (name: string) => {
      onChange(value.filter((t) => t !== name));
    },
    [value, onChange],
  );

  const handleCreate = useCallback(async () => {
    const name = query.trim();
    if (!name || creating || alreadySelected) return;
    setCreating(true);
    try {
      const tag = await cronApi.createTag(name);
      setTags((prev) =>
        [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
      );
      handleSelect(tag.name);
    } catch {
      handleSelect(name);
    } finally {
      setCreating(false);
    }
  }, [query, creating, alreadySelected, handleSelect]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (query.trim() && !exactMatch && !alreadySelected) {
        handleCreate();
      } else if (filtered.length > 0) {
        handleSelect(filtered[0].name);
      }
    }
    if (e.key === "Backspace" && !query && value.length > 0) {
      handleRemove(value[value.length - 1]);
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showDropdown =
    open &&
    (filtered.length > 0 ||
      (query.trim() && !exactMatch && !alreadySelected));

  return (
    <div className={styles.container} ref={containerRef}>
      <div
        className={styles.pillContainer}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className={styles.chip}>
            <span className={styles.chipLabel}>{tag}</span>
            <button
              type="button"
              className={styles.chipRemove}
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(tag);
              }}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className={styles.chipInput}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? "Select or create tags" : ""}
        />
      </div>
      {showDropdown && (
        <div className={styles.dropdown}>
          {filtered.map((t) => (
            <button
              key={t.tag_id}
              type="button"
              className={styles.option}
              onClick={() => handleSelect(t.name)}
            >
              {t.name}
            </button>
          ))}
          {query.trim() && !exactMatch && !alreadySelected && (
            <button
              type="button"
              className={`${styles.option} ${styles.createOption}`}
              onClick={handleCreate}
              disabled={creating}
            >
              <Text variant="muted" size="xs">
                {creating ? "Creating..." : `Create "${query.trim()}"`}
              </Text>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
