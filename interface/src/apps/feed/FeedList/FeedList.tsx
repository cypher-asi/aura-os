import { useMemo, useCallback, useEffect } from "react";
import { ListTree, type ListTreeNode } from "../../../components/ListTree";
import { useFeed, useFeedStore } from "../../../stores/feed-store";
import type { FeedFilter } from "../../../stores/feed-store";
import { FEED_FILTERS } from "../feed-filters";
import styles from "./FeedList.module.css";

export function FeedList() {
  const init = useFeedStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  const { filter, setFilter } = useFeed();

  const data: ListTreeNode[] = useMemo(
    () => FEED_FILTERS.map((f) => ({ id: f.id, label: f.label, icon: f.icon })),
    [],
  );

  const handleSelect = useCallback(
    (node: ListTreeNode) => {
      setFilter(node.id as FeedFilter);
    },
    [setFilter],
  );

  return (
    <div className={styles.list}>
      <ListTree nodes={data} selectedId={filter} onSelect={handleSelect} />
    </div>
  );
}
