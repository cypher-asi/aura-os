import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { ProjectId } from "../../../../shared/types";
import { EmptyState } from "../../../../components/EmptyState";
import {
  channelForTab,
  useDebugSidekickStore,
  type DebugSidekickTab,
} from "../../stores/debug-sidekick-store";
import { useDebugRunMetadata } from "../../useDebugRunMetadata";
import { useDebugRunLogs } from "../../useDebugRunLogs";
import { collectTypes } from "../../format-entry";
import { RunInfoTab } from "./RunInfoTab";
import { FiltersPanel } from "./FiltersPanel";
import { EntryInspector } from "./EntryInspector";
import { ChannelSummary } from "./ChannelSummary";
import { StatsTab } from "./StatsTab";
import { TasksTab } from "./TasksTab";
import sidekickStyles from "../../../../components/Sidekick/Sidekick.module.css";
import styles from "./DebugSidekickContent.module.css";

/**
 * Root of the Debug sidekick. Mirrors `ProcessSidekickContent`:
 *
 * - When a log row is selected in the middle panel, the inspector
 *   takes over the content area (analogous to `selectedNode`).
 * - Otherwise the active tab drives which panel renders. Switching
 *   one of the channel tabs (Events / LLM / Iterations / Blockers /
 *   Retries) also changes which JSONL stream the middle panel reads.
 */
export function DebugSidekickContent() {
  const { projectId, runId } = useParams<{
    projectId: ProjectId;
    runId: string;
  }>();
  const { activeTab, selectedEntry, resetForRun } = useDebugSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      selectedEntry: s.selectedEntry,
      resetForRun: s.resetForRun,
    })),
  );

  // Clear selection / filters when navigating between runs so stale
  // row indices from the previous run don't leak forward.
  useEffect(() => {
    resetForRun();
  }, [projectId, runId, resetForRun]);

  if (!projectId || !runId) {
    return (
      <div className={sidekickStyles.sidekickBody} data-agent-surface="sidekick-panel">
        <EmptyState>Select a run to see details</EmptyState>
      </div>
    );
  }

  return (
    <div className={sidekickStyles.sidekickBody} data-agent-surface="sidekick-panel">
      <div className={sidekickStyles.sidekickContent}>
        <div className={sidekickStyles.tabContent}>
          {selectedEntry ? (
            <EntryInspector entry={selectedEntry} />
          ) : (
            <TabBody
              tab={activeTab}
              projectId={projectId}
              runId={runId}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TabBody({
  tab,
  projectId,
  runId,
}: {
  tab: DebugSidekickTab;
  projectId: ProjectId;
  runId: string;
}) {
  if (tab === "run") return <RunInfoTab />;
  if (tab === "stats") return <StatsTab />;
  if (tab === "tasks") return <TasksTab />;

  const channel = channelForTab(tab);
  if (!channel) return null;

  return <ChannelPanel projectId={projectId} runId={runId} channel={channel} />;
}

function ChannelPanel({
  projectId,
  runId,
  channel,
}: {
  projectId: ProjectId;
  runId: string;
  channel: NonNullable<ReturnType<typeof channelForTab>>;
}) {
  const { isRunning } = useDebugRunMetadata(projectId, runId);
  const { entries } = useDebugRunLogs({
    projectId,
    runId,
    channel,
    isRunning,
  });
  const types = collectTypes(entries);

  return (
    <div className={styles.channelPanel}>
      <FiltersPanel types={types} />
      <ChannelSummary entries={entries} />
    </div>
  );
}
