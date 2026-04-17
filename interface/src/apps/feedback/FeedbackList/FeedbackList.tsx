import { useCallback, useEffect, useMemo, useState } from "react";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { ProjectsPlusButton } from "../../../components/ProjectsPlusButton/ProjectsPlusButton";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import { useFeedback } from "../../../stores/feedback-store";
import type { FeedbackCategory, FeedbackSort, FeedbackStatus } from "../types";
import {
  FEEDBACK_ALL_CATEGORY_ICON,
  FEEDBACK_ALL_STATUS_ICON,
  FEEDBACK_CATEGORY_FILTERS,
  FEEDBACK_SORT_FILTERS,
  FEEDBACK_STATUS_FILTERS,
} from "../feedback-filters";
import { NewFeedbackModal } from "../NewFeedbackModal";
import styles from "./FeedbackList.module.css";

const ALL_CATEGORY_ID = "__all_categories__";
const ALL_STATUS_ID = "__all_statuses__";

export function FeedbackList() {
  const {
    sort,
    setSort,
    categoryFilter,
    setCategoryFilter,
    statusFilter,
    setStatusFilter,
  } = useFeedback();
  const { setAction } = useSidebarSearch("feedback");
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setAction(
      "feedback",
      <ProjectsPlusButton
        onClick={() => setIsModalOpen(true)}
        title="New Feedback"
      />,
    );
    return () => setAction("feedback", null);
  }, [setAction]);

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

  const sortSelectedIds = useMemo(() => [sort], [sort]);
  const categorySelectedIds = useMemo(
    () => [categoryFilter ?? ALL_CATEGORY_ID],
    [categoryFilter],
  );
  const statusSelectedIds = useMemo(
    () => [statusFilter ?? ALL_STATUS_ID],
    [statusFilter],
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
    <>
      <div className={styles.list}>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Trending</div>
          <Explorer
            data={sortData}
            enableDragDrop={false}
            enableMultiSelect={false}
            defaultSelectedIds={sortSelectedIds}
            onSelect={handleSortSelect}
          />
        </div>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Type</div>
          <Explorer
            data={categoryData}
            enableDragDrop={false}
            enableMultiSelect={false}
            defaultSelectedIds={categorySelectedIds}
            onSelect={handleCategorySelect}
          />
        </div>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Status</div>
          <Explorer
            data={statusData}
            enableDragDrop={false}
            enableMultiSelect={false}
            defaultSelectedIds={statusSelectedIds}
            onSelect={handleStatusSelect}
          />
        </div>
      </div>
      <NewFeedbackModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
