import { AgentList } from "../../../apps/agents/AgentList";
import { PanelSearch } from "../../../components/PanelSearch";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import { PendingAgentSends } from "../PendingAgentSends";
import styles from "./MobileAgentLibraryView.module.css";

export function MobileAgentLibraryView() {
  const { query, setQuery } = useSidebarSearch("agents");

  return (
    <div className={styles.root}>
      <PendingAgentSends />
      <div className={styles.search}>
        <PanelSearch
          placeholder="Search agents and conversations"
          value={query}
          onChange={setQuery}
        />
      </div>
      <div className={styles.list}>
        <AgentList mode="mobile-library" />
      </div>
    </div>
  );
}
