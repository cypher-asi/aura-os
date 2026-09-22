import { AgentList } from "../../../apps/agents/AgentList";
import { PendingAgentSends } from "../PendingAgentSends";
import styles from "./MobileAgentLibraryView.module.css";

export function MobileAgentLibraryView() {
  return (
    <div className={styles.root}>
      <PendingAgentSends />
      <div className={styles.list}>
        <AgentList mode="mobile-library" />
      </div>
    </div>
  );
}
