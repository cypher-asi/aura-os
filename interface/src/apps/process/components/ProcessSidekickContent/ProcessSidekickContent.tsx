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
  const storeNodes = useProcessStore((s) => (processId ? s.nodes[processId] : undefined));
  const process = processes.find((p) => p.process_id === processId);

  const liveNode =
    selectedNode && storeNodes
      ? storeNodes.find((n) => n.node_id === selectedNode.node_id) ?? selectedNode
      : selectedNode;

  if (!processId) {
    return (
      <div className={styles.sidekickBody}>
        <EmptyState>Select a process</EmptyState>
      </div>
    );
  }

  if (selectedNode && liveNode) {
    return (
      <div className={styles.sidekickBody}>
        <div className={styles.sidekickContent}>
          <div className={styles.tabContent}>
            {activeNodeTab === "info" && <NodeInfoTab node={liveNode} />}
            {activeNodeTab === "config" && <NodeConfigTab node={liveNode} />}
            {activeNodeTab === "connections" && <NodeConnectionsTab node={liveNode} />}
            {activeNodeTab === "output" && <NodeOutputTab node={liveNode} />}
          </div>
        </div>
        <NodeEditorModal
          isOpen={nodeEditRequested}
          node={liveNode}
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
            <RunPreviewBody key={previewRun.run_id} run={previewRun} />
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
