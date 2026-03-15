import { useMemo, useCallback } from "react";
import { Text, Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Bot, User } from "lucide-react";
import { useFeed } from "./FeedProvider";
import { useSidebarSearch } from "../../context/SidebarSearchContext";
import styles from "./FeedList.module.css";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function FeedList() {
  const { events, selectedEventId, selectEvent } = useFeed();
  const { query: searchQuery } = useSidebarSearch();

  const data: ExplorerNode[] = useMemo(
    () =>
      events.map((evt) => ({
        id: evt.id,
        label: `${evt.author.name} → ${evt.repo.split("/").pop()}`,
        description: timeAgo(evt.timestamp),
        icon:
          evt.author.type === "agent" ? (
            <Bot size={14} />
          ) : (
            <User size={14} />
          ),
      })),
    [events],
  );

  const filteredData = useMemo(() => {
    if (!searchQuery) return data;
    const q = searchQuery.toLowerCase();
    return data.filter((n) => n.label.toLowerCase().includes(q));
  }, [data, searchQuery]);

  const defaultSelectedIds = useMemo(
    () => (selectedEventId ? [selectedEventId] : []),
    [selectedEventId],
  );

  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1];
      selectEvent(id ?? null);
    },
    [selectEvent],
  );

  if (events.length === 0) {
    return (
      <div className={styles.empty}>
        <Text variant="muted" size="sm">No activity yet</Text>
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
