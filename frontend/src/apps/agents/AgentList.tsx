import { useMemo, useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Text, Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Bot, Loader2 } from "lucide-react";
import { useAgentApp } from "./AgentAppProvider";
import { useSidebarSearch } from "../../context/SidebarSearchContext";
import styles from "./AgentList.module.css";

export function AgentList() {
  const { agents, loading } = useAgentApp();
  const { query: searchQuery } = useSidebarSearch();
  const navigate = useNavigate();
  const { agentId } = useParams();
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());

  const data: ExplorerNode[] = useMemo(
    () =>
      agents.map((a) => ({
        id: a.agent_id,
        label: a.name,
        icon: a.icon && !failedIcons.has(a.agent_id)
          ? <img
              src={a.icon}
              alt=""
              className={styles.agentAvatar}
              onError={() => setFailedIcons((prev) => new Set(prev).add(a.agent_id))}
            />
          : <Bot size={14} />,
      })),
    [agents, failedIcons],
  );

  const filteredData = useMemo(() => {
    if (!searchQuery) return data;
    const q = searchQuery.toLowerCase();
    return data.filter((n) => n.label.toLowerCase().includes(q));
  }, [data, searchQuery]);

  const defaultSelectedIds = useMemo(
    () => (agentId ? [agentId] : []),
    [agentId],
  );

  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1];
      if (id) navigate(`/agents/${id}`);
    },
    [navigate],
  );

  if (loading) {
    return (
      <div className={styles.loading}>
        <Loader2 size={18} className={styles.spin} />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className={styles.empty}>
        <Text variant="muted" size="sm">No agents yet</Text>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      <Explorer
        data={filteredData}
        enableDragDrop={false}
        enableMultiSelect={false}
        defaultSelectedIds={defaultSelectedIds}
        onSelect={handleSelect}
      />
    </div>
  );
}
