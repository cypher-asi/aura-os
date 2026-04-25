import { List, Search, FolderSearch, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { TOOL_LABELS } from "../../../constants/tools";
import { decodeCapturedOutput, summarizeInput } from "../../../shared/utils/format";
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

/**
 * Turn captured CLI-style stdout (one entry per line) into list rows. Used for
 * Codex-provided MCP tools (`list_files`, `find_files`, `search_code`) whose
 * payload is a base64-encoded newline-separated listing inside the tool
 * envelope's `stdout` field.
 *
 * For `search_code`-style `path:line:match` lines we split into a primary
 * (file:line) and secondary (match preview) column so long matches don't
 * overflow the row.
 */
function rowsFromTextOutput(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.slice(0, 200).map((line, i) => {
    const m = line.match(/^([^:\s]+:\d+):\s*(.*)$/);
    if (m) {
      return { id: `r-${i}`, primary: m[1], secondary: m[2] };
    }
    return { id: `r-${i}`, primary: line };
  });
}

/**
 * Resolve the most useful row list from a tool result string. Native list_*
 * tools return bare JSON with an array somewhere in the first level. Codex
 * MCP tools (`list_files`, `find_files`, `search_code`) wrap the payload in
 * `{ok, stdout: <base64>, stderr, metadata}` — we decode `stdout` and treat
 * it as either JSON (if it parses) or newline-separated plain text.
 */
function resolveRows(result: string | undefined): ParsedRow[] {
  if (!result) return [];

  const parsed = safeJsonParse(result);
  const direct = extractRows(parsed);
  if (direct.length > 0) return direct;

  const envelope = decodeCapturedOutput(result);
  const stdout = envelope.stdout;
  if (!stdout) return direct;

  const innerParsed = safeJsonParse(stdout);
  if (innerParsed !== null) {
    const fromInner = extractRows(innerParsed);
    if (fromInner.length > 0) return fromInner;
  }
  return rowsFromTextOutput(stdout);
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

  const rows = resolveRows(entry.result);

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
