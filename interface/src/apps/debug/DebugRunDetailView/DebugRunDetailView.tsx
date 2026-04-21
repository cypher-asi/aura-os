import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { DebugChannel } from "../../../api/debug";
import { api } from "../../../api/client";
import type { ProjectId } from "../../../types";
import { useDebugRunMetadata } from "../useDebugRunMetadata";
import { useDebugRunLogs } from "../useDebugRunLogs";
import { collectTypes } from "../format-entry";
import { DebugRunToolbar } from "./DebugRunToolbar";
import { DebugRunCounters } from "./DebugRunCounters";
import { DebugLogList } from "./DebugLogList";
import { DebugEntryInspector } from "./DebugEntryInspector";
import styles from "./DebugRunDetailView.module.css";

/**
 * Trigger a browser download of `blob` with the given file name. Kept
 * local instead of extracted into a shared helper because this is the
 * only caller today (per `rules-react-components` "no premature
 * framework" guidance); promote if/when a second call site appears.
 */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

export function DebugRunDetailView() {
  const { projectId, runId } = useParams<{
    projectId: ProjectId;
    runId: string;
  }>();

  const [channel, setChannel] = useState<DebugChannel>("events");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [textFilter, setTextFilter] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const { metadata, isRunning } = useDebugRunMetadata(projectId, runId);
  const { entries, raw, isLoading } = useDebugRunLogs({
    projectId,
    runId,
    channel,
    isRunning,
  });

  const filteredEntries = useMemo(() => {
    if (!typeFilter && !textFilter) return entries;
    const needle = textFilter.toLowerCase();
    return entries.filter((entry) => {
      if (typeFilter && entry.type !== typeFilter) return false;
      if (needle && !entry.raw.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entries, typeFilter, textFilter]);

  const types = useMemo(() => collectTypes(entries), [entries]);

  const selectedEntry = useMemo(() => {
    if (selectedIndex === null) return null;
    return (
      filteredEntries.find((e) => e.index === selectedIndex) ??
      entries.find((e) => e.index === selectedIndex) ??
      null
    );
  }, [selectedIndex, filteredEntries, entries]);

  const handleCopy = useCallback(() => {
    if (!raw) return;
    void copyToClipboard(raw);
  }, [raw]);

  const handleExport = useCallback(async () => {
    if (!projectId || !runId) return;
    try {
      const blob = await api.debug.exportRunBlob(projectId, runId);
      downloadBlob(blob, `debug-${projectId}-${runId}.zip`);
    } catch (error) {
      console.error("debug export failed", error);
    }
  }, [projectId, runId]);

  if (!projectId || !runId) {
    return <div className={styles.empty}>Run not found.</div>;
  }

  return (
    <div className={styles.root}>
      <DebugRunToolbar
        metadata={metadata}
        channel={channel}
        onChannelChange={(c) => {
          setChannel(c);
          setSelectedIndex(null);
        }}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        textFilter={textFilter}
        onTextFilterChange={setTextFilter}
        types={types}
        onCopy={handleCopy}
        onExport={() => {
          void handleExport();
        }}
        copyDisabled={!raw}
        exportDisabled={false}
      />
      <DebugRunCounters metadata={metadata} />
      <div className={styles.body}>
        <DebugLogList
          entries={filteredEntries}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          emptyMessage={
            isLoading
              ? "Loading events…"
              : entries.length === 0
                ? "No events recorded on this channel yet."
                : "No events match the current filters."
          }
        />
        <DebugEntryInspector
          entry={selectedEntry}
          onCopy={(text) => {
            void copyToClipboard(text);
          }}
        />
      </div>
    </div>
  );
}
