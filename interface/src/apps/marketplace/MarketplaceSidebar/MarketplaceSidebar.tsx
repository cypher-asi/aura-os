import { createElement, useMemo, useState } from "react";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { FolderSection } from "../../../components/FolderSection";
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

  const trendingNodes = useMemo<ExplorerNode[]>(
    () =>
      MARKETPLACE_TRENDING_SORTS.map((s) => ({
        id: s.id,
        label: s.label,
        icon: createElement(s.icon, { size: 14 }),
      })),
    [],
  );

  const expertiseNodes = useMemo<ExplorerNode[]>(
    () =>
      MARKETPLACE_EXPERTISE.map((e) => ({
        id: e.id,
        label: e.label,
        icon: createElement(e.icon, { size: 14 }),
      })),
    [],
  );

  const selectedIds = useMemo(
    () => (expertiseFilter ? [expertiseFilter] : [sort]),
    [expertiseFilter, sort],
  );

  const handleSelect = (ids: string[]) => {
    const next = ids[ids.length - 1];
    if (!next) return;
    if (TRENDING_SORT_IDS.has(next)) {
      setSort(next as MarketplaceTrendingSort);
      setExpertiseFilter(null);
      return;
    }
    setExpertiseFilter(next);
  };

  return (
    <div className={styles.sidebar}>
      <FolderSection
        label="Trending"
        expanded={trendingExpanded}
        onToggle={() => setTrendingExpanded((v) => !v)}
      >
        <Explorer
          data={trendingNodes}
          enableDragDrop={false}
          enableMultiSelect={false}
          defaultSelectedIds={selectedIds}
          onSelect={handleSelect}
        />
      </FolderSection>
      <FolderSection
        label="Expertise"
        expanded={expertiseExpanded}
        onToggle={() => setExpertiseExpanded((v) => !v)}
      >
        <Explorer
          data={expertiseNodes}
          enableDragDrop={false}
          enableMultiSelect={false}
          defaultSelectedIds={selectedIds}
          onSelect={handleSelect}
        />
      </FolderSection>
    </div>
  );
}
