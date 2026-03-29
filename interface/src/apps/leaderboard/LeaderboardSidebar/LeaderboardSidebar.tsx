import { useMemo, useCallback } from "react";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { useLeaderboard } from "../../../stores/leaderboard-store";
import type { LeaderboardFilter } from "../mockData";
import { LEADERBOARD_FILTERS } from "../leaderboardFilters";
import styles from "./LeaderboardSidebar.module.css";

export function LeaderboardSidebar() {
  const { filter, setFilter } = useLeaderboard();

  const data: ExplorerNode[] = useMemo(
    () => LEADERBOARD_FILTERS.map((f) => ({ id: f.id, label: f.label, icon: f.icon })),
    [],
  );

  const defaultSelectedIds = useMemo(() => [filter], [filter]);

  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1] as LeaderboardFilter | undefined;
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
