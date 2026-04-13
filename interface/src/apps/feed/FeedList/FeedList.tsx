import { useMemo, useCallback, useEffect } from "react";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { useFeed, useFeedStore } from "../../../stores/feed-store";
import type { FeedFilter } from "../../../stores/feed-store";
import { FEED_FILTERS } from "../feedFilters";
import styles from "./FeedList.module.css";

export function FeedList() {
  const init = useFeedStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  const { filter, setFilter } = useFeed();

  const data: ExplorerNode[] = useMemo(
    () => FEED_FILTERS.map((f) => ({ id: f.id, label: f.label, icon: f.icon })),
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
