import type { DebugChannel, DebugRunMetadata } from "../../../api/debug";
import styles from "./DebugRunDetailView.module.css";

const CHANNELS: { id: DebugChannel; label: string }[] = [
  { id: "events", label: "All events" },
  { id: "llm_calls", label: "LLM calls" },
  { id: "iterations", label: "Iterations" },
  { id: "blockers", label: "Blockers" },
  { id: "retries", label: "Retries" },
];

interface Props {
  metadata: DebugRunMetadata | undefined;
  channel: DebugChannel;
  onChannelChange: (channel: DebugChannel) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  textFilter: string;
  onTextFilterChange: (value: string) => void;
  types: string[];
  onCopy: () => void;
  onExport: () => void;
  copyDisabled: boolean;
  exportDisabled: boolean;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function DebugRunToolbar({
  metadata,
  channel,
  onChannelChange,
  typeFilter,
  onTypeFilterChange,
  textFilter,
  onTextFilterChange,
  types,
  onCopy,
  onExport,
  copyDisabled,
  exportDisabled,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.title}>
        <span className={styles.titleMain}>
          {metadata?.run_id ?? "Run"} ·{" "}
          {metadata?.status ?? "loading"}
        </span>
        <span className={styles.titleSub}>
          Started {formatDate(metadata?.started_at)}
          {metadata?.ended_at
            ? ` · ended ${formatDate(metadata.ended_at)}`
            : ""}
        </span>
      </div>
      <select
        className={styles.select}
        value={channel}
        onChange={(e) => onChannelChange(e.target.value as DebugChannel)}
        aria-label="Channel"
      >
        {CHANNELS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={typeFilter}
        onChange={(e) => onTypeFilterChange(e.target.value)}
        aria-label="Event type"
      >
        <option value="">All types</option>
        {types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input
        className={styles.input}
        type="search"
        placeholder="Filter text"
        value={textFilter}
        onChange={(e) => onTextFilterChange(e.target.value)}
        aria-label="Filter text"
      />
      <button
        type="button"
        className={styles.button}
        onClick={onCopy}
        disabled={copyDisabled}
      >
        Copy JSONL
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={onExport}
        disabled={exportDisabled}
      >
        Export .zip
      </button>
    </div>
  );
}
