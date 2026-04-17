import { Fragment } from "react";
import { Gauge } from "lucide-react";
import type { ToolCallEntry } from "../../../types/stream";
import { TOOL_LABELS } from "../../../constants/tools";
import { Block } from "../Block";
import styles from "./renderers.module.css";

function parseResult(result: string | null | undefined): unknown {
  if (!result) return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

const INTERESTING_KEY_ORDER = [
  "name",
  "title",
  "id",
  "status",
  "current_status",
  "balance_formatted",
  "balance_cents",
  "plan",
  "description",
];

function extractKeyValuePairs(result: unknown, max = 8): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  if (!result || typeof result !== "object") return pairs;
  const obj = result as Record<string, unknown>;

  const seen = new Set<string>();
  for (const key of INTERESTING_KEY_ORDER) {
    if (pairs.length >= max) break;
    if (key in obj && !seen.has(key)) {
      const v = obj[key];
      if (v != null && typeof v !== "object") {
        pairs.push([key, String(v)]);
        seen.add(key);
      }
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    if (pairs.length >= max) break;
    if (seen.has(key)) continue;
    if (value == null) continue;
    if (typeof value === "object") continue;
    pairs.push([key, String(value)]);
  }

  return pairs;
}

interface StatusReadoutBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function StatusReadoutBlock({ entry, defaultExpanded }: StatusReadoutBlockProps) {
  const parsed = parseResult(entry.result);
  const pairs = extractKeyValuePairs(parsed);
  const label = TOOL_LABELS[entry.name] || entry.name;
  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";

  return (
    <Block
      icon={<Gauge size={12} />}
      title={label}
      status={status}
      defaultExpanded={defaultExpanded ?? false}
      flushBody
    >
      {entry.pending && !entry.result ? (
        <div className={styles.listEmpty}>Loading…</div>
      ) : entry.isError && entry.result ? (
        <div className={styles.inlineError}>{String(entry.result).slice(0, 240)}</div>
      ) : pairs.length === 0 ? (
        <div className={styles.listEmpty}>No data.</div>
      ) : (
        <div className={styles.kvGrid}>
          {pairs.map(([k, v]) => (
            <Fragment key={k}>
              <span className={styles.kvKey}>{k.replace(/_/g, " ")}</span>
              <span className={styles.kvValue} title={v}>{v}</span>
            </Fragment>
          ))}
        </div>
      )}
    </Block>
  );
}
