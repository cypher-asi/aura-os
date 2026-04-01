import { useState, useEffect, useRef, useCallback } from "react";
import { Input, Text } from "@cypher-asi/zui";
import { cronApi } from "../../../api/cron";
import type { CronTag } from "../../../types";
import styles from "./TagSelector.module.css";

interface Props {
  value: string;
  onChange: (tag: string) => void;
}

export function TagSelector({ value, onChange }: Props) {
  const [tags, setTags] = useState<CronTag[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cronApi.listTags().then(setTags).catch(() => {});
  }, []);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = tags.filter((t) =>
    t.name.toLowerCase().includes(query.toLowerCase()),
  );

  const exactMatch = tags.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());

  const handleSelect = useCallback(
    (name: string) => {
      setQuery(name);
      onChange(name);
      setOpen(false);
    },
    [onChange],
  );

  const handleCreate = useCallback(async () => {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const tag = await cronApi.createTag(name);
      setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      handleSelect(tag.name);
    } catch {
      handleSelect(name);
    } finally {
      setCreating(false);
    }
  }, [query, creating, handleSelect]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!exactMatch && query.trim()) {
        handleCreate();
      } else if (filtered.length > 0) {
        handleSelect(filtered[0].name);
      }
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Select or create a tag"
      />
      {open && (filtered.length > 0 || (query.trim() && !exactMatch)) && (
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
          {query.trim() && !exactMatch && (
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
