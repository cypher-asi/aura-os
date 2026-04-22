import { useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { DebugRunMetadata, DebugRunStatus } from "../../../api/debug";
import { api } from "../../../api/client";
import type { ProjectId } from "../../../types";
import { useDebugRunMetadata } from "../useDebugRunMetadata";
import { useDebugRunLogs } from "../useDebugRunLogs";
import {
  channelForTab,
  useDebugSidekickStore,
} from "../stores/debug-sidekick-store";
import { copyToClipboard, downloadBlob } from "../clipboard";
import { DebugLogList } from "./DebugLogList";
import styles from "./DebugRunDetailView.module.css";

function statusLabel(status: DebugRunStatus | undefined): string {
  if (!status) return "—";
  // Title-case single words like "failed" → "Failed" so the combined
  // header reads naturally without needing CSS `text-transform`, which
  // would also mangle locale date parts like "PM" → "Pm".
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function runTitle(metadata: DebugRunMetadata | undefined): string {
  // Always render as "Run · <started> · <status>" on one line so the
  // header footprint is stable while metadata loads. When metadata is
  // missing we render em-dash placeholders rather than shorter strings
  // so the right-hand content never reflows.
  const started = metadata?.started_at
    ? new Date(metadata.started_at)
    : null;
  const startedLabel =
    started && !Number.isNaN(started.getTime())
      ? started.toLocaleString()
      : metadata
        ? metadata.run_id.slice(0, 8)
        : "—";
  return `Run · ${startedLabel} · ${statusLabel(metadata?.status)}`;
}

/**
 * Middle-panel view for a single debug run. All filter/channel/action
 * controls live in the Sidekick; this surface focuses on showing the
 * active event timeline and forwarding row selection to the sidekick
 * store so the inspector can take over the right pane.
 */
export function DebugRunDetailView() {
  const { projectId, runId } = useParams<{
    projectId: ProjectId;
    runId: string;
  }>();
  const { activeTab, typeFilter, textFilter, selectedEntry, selectEntry } =
    useDebugSidekickStore(
      useShallow((s) => ({
        activeTab: s.activeTab,
        typeFilter: s.typeFilter,
        textFilter: s.textFilter,
        selectedEntry: s.selectedEntry,
        selectEntry: s.selectEntry,
      })),
    );

  // Pull the channel from the active tab. Non-channel tabs (run/stats/
  // tasks) default the middle panel to the primary "events" stream so
  // the timeline is always useful even when the sidekick is not on an
  // event-style tab.
  const channel = channelForTab(activeTab) ?? "events";

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

  // "Copy all" follows the visible timeline: when no filter is active
  // we copy the full channel JSONL (cheap string), otherwise we join
  // the filtered rows so users get exactly what they see.
  const hasFilter = Boolean(typeFilter || textFilter);
  const copyPayload = useMemo(() => {
    if (!hasFilter) return raw;
    return filteredEntries.map((e) => e.raw).join("\n");
  }, [hasFilter, raw, filteredEntries]);

  const handleCopyAll = useCallback(() => {
    if (!copyPayload) return;
    void copyToClipboard(copyPayload);
  }, [copyPayload]);

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

  // The default "events" channel's label is redundant with the sidekick
  // tabs and the event count, so we suppress the big label for it but
  // still show it for more specific channels (llm_calls, blockers, ...)
  // where it acts as a signpost for what is currently on screen.
  const channelHeading = channel === "events" ? null : channelLabel(channel);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.titleMain}>{runTitle(metadata)}</span>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={handleCopyAll}
            disabled={!copyPayload}
            title={
              hasFilter
                ? "Copy the filtered events as JSONL"
                : "Copy the full channel as JSONL"
            }
          >
            {hasFilter ? "Copy filtered" : "Copy all"}
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => {
              void handleExport();
            }}
            title="Download the full run bundle as .zip"
          >
            Export
          </button>
        </div>
        <div className={styles.channelLabel}>
          {channelHeading}
          {filteredEntries.length !== entries.length ? (
            <span className={styles.channelSubLabel}>
              {filteredEntries.length} of {entries.length}
            </span>
          ) : (
            <span className={styles.channelSubLabel}>
              {entries.length} event{entries.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </header>
      <div className={styles.body}>
        <DebugLogList
          entries={filteredEntries}
          selectedIndex={selectedEntry?.index ?? null}
          onSelect={(index) => {
            const hit =
              filteredEntries.find((e) => e.index === index) ??
              entries.find((e) => e.index === index) ??
              null;
            selectEntry(hit);
          }}
          emptyMessage={
            isLoading
              ? "Loading events…"
              : entries.length === 0
                ? "No events recorded on this channel yet."
                : "No events match the current filters."
          }
        />
      </div>
    </div>
  );
}

function channelLabel(channel: string): string {
  switch (channel) {
    case "events":
      return "All events";
    case "llm_calls":
      return "LLM calls";
    case "iterations":
      return "Iterations";
    case "blockers":
      return "Blockers";
    case "retries":
      return "Retries";
    default:
      return channel;
  }
}
