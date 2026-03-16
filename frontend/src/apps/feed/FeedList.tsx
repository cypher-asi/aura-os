import { useMemo, useCallback } from "react";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Bot, Building2, UserCheck, Globe } from "lucide-react";
import { useFeed } from "./FeedProvider";
import type { FeedFilter } from "./FeedProvider";
import styles from "./FeedList.module.css";

const filters: { id: FeedFilter; label: string; icon: React.ReactNode }[] = [
  { id: "my-agents", label: "My Agents", icon: <Bot size={14} /> },
  { id: "organization", label: "Organization", icon: <Building2 size={14} /> },
  { id: "following", label: "Following", icon: <UserCheck size={14} /> },
  { id: "everything", label: "Everything", icon: <Globe size={14} /> },
];

export function FeedList() {
  const { filter, setFilter } = useFeed();

  const data: ExplorerNode[] = useMemo(
    () => filters.map((f) => ({ id: f.id, label: f.label, icon: f.icon })),
    [],
  );

  const defaultSelectedIds = useMemo(() => [filter], [filter]);

  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1] as FeedFilter | undefined;
      if (id) setFilter(id);
    },
    [setFilter],
  );

  return (
    <div className={styles.list}>
      <Explorer
        data={data}
        enableDragDrop={false}
        enableMultiSelect={false}
        defaultSelectedIds={defaultSelectedIds}
        onSelect={handleSelect}
      />
    </div>
  );
}
