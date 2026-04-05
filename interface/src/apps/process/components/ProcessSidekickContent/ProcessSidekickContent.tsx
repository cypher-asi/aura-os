import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { EmptyState } from "../../../../components/EmptyState";
import { PreviewOverlay } from "../../../../components/PreviewOverlay";
import { ProcessEditorModal } from "../ProcessEditorModal";
import { NodeEditorModal } from "../NodeEditorModal";
import { NodeInfoTab } from "../NodeInfoTab";
import { NodeConfigTab } from "../NodeConfigTab";
import { NodeConnectionsTab } from "../NodeConnectionsTab";
import { NodeOutputTab } from "../NodeOutputTab";
import { ProcessInfoTab } from "./ProcessInfoTab";
import { RunList } from "./RunList";
import { EventsTimeline } from "./EventTimelineItem";
import { StatsView } from "./StatsView";
import { RunPreviewBody } from "./RunPreviewBody";
import { EMPTY_RUNS } from "./process-sidekick-utils";
import styles from "../../../../components/Sidekick/Sidekick.module.css";

export function ProcessSidekickContent() {
  const { processId } = useParams<{ processId: string }>();
  const {
    activeTab, activeNodeTab, previewRun, selectedNode,
    showEditor, nodeEditRequested, viewRun, closePreview,
    closeEditor, clearNodeEditRequested,
  } = useProcessSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      activeNodeTab: s.activeNodeTab,
      previewRun: s.previewRun,
      selectedNode: s.selectedNode,
      showEditor: s.showEditor,
      nodeEditRequested: s.nodeEditRequested,
      viewRun: s.viewRun,
      closePreview: s.closePreview,
      closeEditor: s.closeEditor,
      clearNodeEditRequested: s.clearNodeEditRequested,
    })),
  );

  const processes = useProcessStore((s) => s.processes);
  const runs = useProcessStore((s) => (processId ? s.runs[processId] ?? EMPTY_RUNS : EMPTY_RUNS));
  const process = processes.find((p) => p.process_id === processId);

  if (!processId) {
    return (
      <div className={styles.sidekickBody}>
        <EmptyState>Select a process</EmptyState>
      </div>
    );
  }

  if (selectedNode) {
    return (
      <div className={styles.sidekickBody}>
        <div className={styles.sidekickContent}>
          <div className={styles.tabContent}>
            {activeNodeTab === "info" && <NodeInfoTab node={selectedNode} />}
            {activeNodeTab === "config" && <NodeConfigTab node={selectedNode} />}
            {activeNodeTab === "connections" && <NodeConnectionsTab node={selectedNode} />}
            {activeNodeTab === "output" && <NodeOutputTab node={selectedNode} />}
          </div>
        </div>
        <NodeEditorModal
          isOpen={nodeEditRequested}
          node={selectedNode}
          onClose={clearNodeEditRequested}
        />
      </div>
    );
  }

  if (previewRun) {
    return (
      <div className={styles.sidekickBody}>
        <PreviewOverlay title="Run Detail" onClose={closePreview} fullLane>
          <div style={{ margin: "calc(-1 * var(--space-3, 12px)) 0" }}>
            <RunPreviewBody run={previewRun} />
          </div>
        </PreviewOverlay>
      </div>
    );
  }

  return (
    <div className={styles.sidekickBody}>
      <div className={styles.sidekickContent}>
        <div className={styles.tabContent}>
          {activeTab === "process" && <ProcessInfoTab />}
          {activeTab === "runs" && <RunList runs={runs} onSelect={viewRun} />}
          {activeTab === "events" && <EventsTimeline processId={processId} />}
          {activeTab === "stats" && <StatsView runs={runs} />}
          {activeTab === "log" && <EmptyState>Activity log coming soon</EmptyState>}
        </div>
      </div>
      {process && (
        <ProcessEditorModal isOpen={showEditor} process={process} onClose={closeEditor} />
      )}
    </div>
  );
}
