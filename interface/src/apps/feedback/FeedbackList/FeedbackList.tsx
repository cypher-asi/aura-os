import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { FolderSection } from "../../../components/FolderSection";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { ProjectsPlusButton } from "../../../components/ProjectsPlusButton/ProjectsPlusButton";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import { useFeedback, useFeedbackStore } from "../../../stores/feedback-store";
import type {
  FeedbackCategory,
  FeedbackProduct,
  FeedbackSort,
  FeedbackStatus,
} from "../types";
import {
  FEEDBACK_ALL_CATEGORY_ICON,
  FEEDBACK_ALL_STATUS_ICON,
  FEEDBACK_CATEGORY_FILTERS,
  FEEDBACK_PRODUCT_FILTERS,
  FEEDBACK_SORT_FILTERS,
  FEEDBACK_STATUS_FILTERS,
} from "../feedback-filters";
import styles from "./FeedbackList.module.css";

const ALL_CATEGORY_ID = "__all_categories__";
const ALL_STATUS_ID = "__all_statuses__";

type SectionId = "product" | "trending" | "type" | "status";

export function FeedbackList() {
  const {
    sort,
    setSort,
    categoryFilter,
    setCategoryFilter,
    statusFilter,
    setStatusFilter,
    productFilter,
    setProductFilter,
  } = useFeedback();
  const { setAction } = useSidebarSearch("feedback");
  const openComposer = useFeedbackStore((s) => s.openComposer);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    product: false,
    trending: true,
    type: true,
    status: true,
  });

  useEffect(() => {
    setAction(
      "feedback",
      <ProjectsPlusButton
        onClick={openComposer}
        title="New Idea"
      />,
    );
    return () => setAction("feedback", null);
  }, [setAction, openComposer]);

  const toggleSection = useCallback((id: SectionId) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const productData: ExplorerNode[] = useMemo(
    () =>
      FEEDBACK_PRODUCT_FILTERS.map((f) => ({
        id: f.id,
        label: f.label,
        icon: f.icon,
      })),
    [],
  );

  const sortData: ExplorerNode[] = useMemo(
    () =>
      FEEDBACK_SORT_FILTERS.map((f) => ({
        id: f.id,
        label: f.label,
        icon: f.icon,
      })),
    [],
  );

  const categoryData: ExplorerNode[] = useMemo(
    () => [
      { id: ALL_CATEGORY_ID, label: "All Types", icon: FEEDBACK_ALL_CATEGORY_ICON },
      ...FEEDBACK_CATEGORY_FILTERS.map((f) => ({
        id: f.id,
        label: f.label,
        icon: f.icon,
      })),
    ],
    [],
  );

  const statusData: ExplorerNode[] = useMemo(
    () => [
      { id: ALL_STATUS_ID, label: "All Statuses", icon: FEEDBACK_ALL_STATUS_ICON },
      ...FEEDBACK_STATUS_FILTERS.map((f) => ({
        id: f.id,
        label: f.label,
        icon: f.icon,
      })),
    ],
    [],
  );

  const productSelectedIds = useMemo(() => [productFilter], [productFilter]);

  const sortSelectedIds = useMemo(() => [sort], [sort]);
  const categorySelectedIds = useMemo(
    () => [categoryFilter ?? ALL_CATEGORY_ID],
    [categoryFilter],
  );
  const statusSelectedIds = useMemo(
    () => [statusFilter ?? ALL_STATUS_ID],
    [statusFilter],
  );

  const handleProductSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1] as FeedbackProduct | undefined;
      if (id) setProductFilter(id);
    },
    [setProductFilter],
  );

  const handleSortSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1] as FeedbackSort | undefined;
      if (id) setSort(id);
    },
    [setSort],
  );

  const handleCategorySelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1];
      if (!id) return;
      setCategoryFilter(id === ALL_CATEGORY_ID ? null : (id as FeedbackCategory));
    },
    [setCategoryFilter],
  );

  const handleStatusSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1];
      if (!id) return;
      setStatusFilter(id === ALL_STATUS_ID ? null : (id as FeedbackStatus));
    },
    [setStatusFilter],
  );

  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.list}>
        <FolderSection
          label="Product"
          expanded={expanded.product}
          onToggle={() => toggleSection("product")}
        >
          <Explorer
            data={productData}
            enableDragDrop={false}
            enableMultiSelect={false}
            defaultSelectedIds={productSelectedIds}
            onSelect={handleProductSelect}
          />
        </FolderSection>
        <FolderSection
          label="Trending"
          expanded={expanded.trending}
          onToggle={() => toggleSection("trending")}
        >
          <Explorer
            data={sortData}
            enableDragDrop={false}
            enableMultiSelect={false}
            defaultSelectedIds={sortSelectedIds}
            onSelect={handleSortSelect}
          />
        </FolderSection>
        <FolderSection
          label="Type"
          expanded={expanded.type}
          onToggle={() => toggleSection("type")}
        >
          <Explorer
            data={categoryData}
            enableDragDrop={false}
            enableMultiSelect={false}
            defaultSelectedIds={categorySelectedIds}
            onSelect={handleCategorySelect}
          />
        </FolderSection>
        <FolderSection
          label="Status"
          expanded={expanded.status}
          onToggle={() => toggleSection("status")}
        >
          <Explorer
            data={statusData}
            enableDragDrop={false}
            enableMultiSelect={false}
            defaultSelectedIds={statusSelectedIds}
            onSelect={handleStatusSelect}
          />
        </FolderSection>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
