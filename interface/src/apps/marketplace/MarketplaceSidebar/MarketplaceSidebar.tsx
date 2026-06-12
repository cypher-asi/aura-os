import { createElement, useMemo, useRef, useState } from "react";
import { ListTree, type ListTreeNode } from "../../../components/ListTree";
import { FolderSection } from "../../../components/FolderSection";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { useMarketplaceFilters } from "../stores";
import { MARKETPLACE_EXPERTISE } from "../marketplace-expertise";
import {
  MARKETPLACE_TRENDING_SORTS,
  type MarketplaceTrendingSort,
} from "../marketplace-trending";
import styles from "./MarketplaceSidebar.module.css";

const TRENDING_SORT_IDS = new Set<string>(MARKETPLACE_TRENDING_SORTS.map((s) => s.id));

export function MarketplaceSidebar() {
  const { sort, expertiseFilter, setSort, setExpertiseFilter } = useMarketplaceFilters();
  const [trendingExpanded, setTrendingExpanded] = useState(true);
  const [expertiseExpanded, setExpertiseExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const trendingNodes = useMemo<ListTreeNode[]>(
    () =>
      MARKETPLACE_TRENDING_SORTS.map((s) => ({
        id: s.id,
        label: s.label,
        icon: createElement(s.icon, { size: 14 }),
      })),
    [],
  );

  const expertiseNodes = useMemo<ListTreeNode[]>(
    () =>
      MARKETPLACE_EXPERTISE.map((e) => ({
        id: e.id,
        label: e.label,
        icon: createElement(e.icon, { size: 14 }),
      })),
    [],
  );

  const selectedId = expertiseFilter ?? sort;

  const handleSelect = (node: ListTreeNode) => {
    if (TRENDING_SORT_IDS.has(node.id)) {
      setSort(node.id as MarketplaceTrendingSort);
      setExpertiseFilter(null);
      return;
    }
    setExpertiseFilter(node.id);
  };

  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.list}>
        <FolderSection
          label="Trending"
          expanded={trendingExpanded}
          onToggle={() => setTrendingExpanded((v) => !v)}
        >
          <ListTree
            nodes={trendingNodes}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        </FolderSection>
        <FolderSection
          label="Expertise"
          expanded={expertiseExpanded}
          onToggle={() => setExpertiseExpanded((v) => !v)}
        >
          <ListTree
            nodes={expertiseNodes}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        </FolderSection>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
