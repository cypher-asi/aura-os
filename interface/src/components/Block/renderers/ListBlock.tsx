import { List, Search, FolderSearch, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import type { ToolCallEntry } from "../../../types/stream";
import { TOOL_LABELS } from "../../../constants/tools";
import { summarizeInput } from "../../../utils/format";
import { Block } from "../Block";
import styles from "./renderers.module.css";

interface ListBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

interface ParsedRow {
  id: string;
  primary: string;
  secondary?: string;
}

function safeJsonParse(input: string | undefined): unknown {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

function rowsFromArray(arr: unknown[]): ParsedRow[] {
  return arr.slice(0, 200).map((item, i) => {
    if (typeof item === "string") {
      return { id: `r-${i}`, primary: item };
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const primary =
        pickString(obj, ["title", "name", "path", "file", "id", "key"]) ||
        JSON.stringify(item).slice(0, 120);
      const secondary =
        pickString(obj, ["status", "description", "summary", "kind", "type"]) || undefined;
      const id = pickString(obj, ["id", "key"]) || `r-${i}`;
      return { id, primary, secondary };
    }
    return { id: `r-${i}`, primary: String(item) };
  });
}

/**
 * Very tolerant "find any array on this object" helper. Backends return results
 * wrapped in different envelopes (`{ files: [...] }`, `{ results: [...] }`,
 * `{ specs: [...] }`, etc.). Rather than hard-code every shape, we walk the
 * first level of the object and take the first array we find.
 */
function extractRows(result: unknown): ParsedRow[] {
  if (Array.isArray(result)) return rowsFromArray(result);
  if (result && typeof result === "object") {
    for (const value of Object.values(result as Record<string, unknown>)) {
      if (Array.isArray(value)) return rowsFromArray(value);
    }
  }
  return [];
}

function iconFor(name: string): ReactNode {
  if (name === "search_code") return <Search size={12} />;
  if (name === "find_files") return <FolderSearch size={12} />;
  if (name === "list_files") return <FolderOpen size={12} />;
  return <List size={12} />;
}

export function ListBlock({ entry, defaultExpanded }: ListBlockProps) {
  const label = TOOL_LABELS[entry.name] || entry.name;
  const summary = summarizeInput(entry.name, entry.input);

  const parsed = safeJsonParse(entry.result);
  const rows = extractRows(parsed);

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";
  const trailing = !entry.pending ? (
    <span className={styles.mediaCaption}>{rows.length} {rows.length === 1 ? "item" : "items"}</span>
  ) : null;

  return (
    <Block
      icon={iconFor(entry.name)}
      title={label}
      summary={summary || undefined}
      trailing={trailing}
      status={status}
      defaultExpanded={defaultExpanded ?? false}
      flushBody
    >
      {entry.pending && !entry.result ? (
        <div className={styles.listEmpty}>Searching…</div>
      ) : entry.isError && entry.result ? (
        <div className={styles.inlineError}>{String(entry.result).slice(0, 240)}</div>
      ) : rows.length === 0 ? (
        <div className={styles.listEmpty}>No results.</div>
      ) : (
        rows.map((row, i) => (
          <div key={`${row.id}-${i}`} className={styles.listRow}>
            <span className={styles.listRowIcon}>{iconFor(entry.name)}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.primary}
            </span>
            {row.secondary ? (
              <span className={styles.mediaCaption}>{row.secondary}</span>
            ) : null}
          </div>
        ))
      )}
    </Block>
  );
}
