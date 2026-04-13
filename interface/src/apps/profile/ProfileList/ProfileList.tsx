import { useMemo, useCallback } from "react";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { useProfile } from "../../../stores/profile-store";
import { ALL_PROFILE_PROJECTS_ID, getProfileSelectorItems } from "../profile-selectors";
import styles from "./ProfileList.module.css";

export function ProfileList() {
  const { projects, selectedProject, setSelectedProject } = useProfile();

  const data: ExplorerNode[] = useMemo(
    () => getProfileSelectorItems(projects),
    [projects],
  );

  const defaultSelectedIds = useMemo(
    () => [selectedProject ?? ALL_PROFILE_PROJECTS_ID],
    [selectedProject],
  );

  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1];
      if (!id) return;
      setSelectedProject(id === ALL_PROFILE_PROJECTS_ID ? null : id);
    },
    [setSelectedProject],
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
