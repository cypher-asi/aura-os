import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  FeedbackFilterTree,
  type FeedbackFilterOption,
} from "../FeedbackFilterTree";
import styles from "./FeedbackList.module.css";

const ALL_CATEGORY_ID = "__all_categories__";
const ALL_STATUS_ID = "__all_statuses__";

type CategoryFilterId = FeedbackCategory | typeof ALL_CATEGORY_ID;
type StatusFilterId = FeedbackStatus | typeof ALL_STATUS_ID;

const CATEGORY_FILTER_OPTIONS: ReadonlyArray<FeedbackFilterOption<CategoryFilterId>> = [
  { id: ALL_CATEGORY_ID, label: "All Types", icon: FEEDBACK_ALL_CATEGORY_ICON },
  ...FEEDBACK_CATEGORY_FILTERS,
];

const STATUS_FILTER_OPTIONS: ReadonlyArray<FeedbackFilterOption<StatusFilterId>> = [
  { id: ALL_STATUS_ID, label: "All Statuses", icon: FEEDBACK_ALL_STATUS_ICON },
  ...FEEDBACK_STATUS_FILTERS,
];

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

  const handleCategorySelect = useCallback(
    (id: CategoryFilterId) => {
      setCategoryFilter(id === ALL_CATEGORY_ID ? null : id);
    },
    [setCategoryFilter],
  );

  const handleStatusSelect = useCallback(
    (id: StatusFilterId) => {
      setStatusFilter(id === ALL_STATUS_ID ? null : id);
    },
    [setStatusFilter],
  );

  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.list}>
        <FeedbackFilterTree<FeedbackProduct>
          label="Product"
          options={FEEDBACK_PRODUCT_FILTERS}
          expanded={expanded.product}
          onToggle={() => toggleSection("product")}
          selectedId={productFilter}
          onSelect={setProductFilter}
        />
        <FeedbackFilterTree<FeedbackSort>
          label="Trending"
          options={FEEDBACK_SORT_FILTERS}
          expanded={expanded.trending}
          onToggle={() => toggleSection("trending")}
          selectedId={sort}
          onSelect={setSort}
        />
        <FeedbackFilterTree<CategoryFilterId>
          label="Type"
          options={CATEGORY_FILTER_OPTIONS}
          expanded={expanded.type}
          onToggle={() => toggleSection("type")}
          selectedId={categoryFilter ?? ALL_CATEGORY_ID}
          onSelect={handleCategorySelect}
        />
        <FeedbackFilterTree<StatusFilterId>
          label="Status"
          options={STATUS_FILTER_OPTIONS}
          expanded={expanded.status}
          onToggle={() => toggleSection("status")}
          selectedId={statusFilter ?? ALL_STATUS_ID}
          onSelect={handleStatusSelect}
        />
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
