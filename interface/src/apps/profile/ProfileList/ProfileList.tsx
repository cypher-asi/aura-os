import { useMemo, useCallback } from "react";
import { ListTree, type ListTreeNode } from "../../../components/ListTree";
import { useProfile } from "../../../stores/profile-store";
import { ALL_PROFILE_PROJECTS_ID, getProfileSelectorItems } from "../profile-selectors";
import styles from "./ProfileList.module.css";

export function ProfileList() {
  const { projects, selectedProject, setSelectedProject } = useProfile();

  const data: ListTreeNode[] = useMemo(
    () => getProfileSelectorItems(projects),
    [projects],
  );

  const handleSelect = useCallback(
    (node: ListTreeNode) => {
      setSelectedProject(node.id === ALL_PROFILE_PROJECTS_ID ? null : node.id);
    },
    [setSelectedProject],
  );

  return (
    <div className={styles.list}>
      <ListTree
        nodes={data}
        selectedId={selectedProject ?? ALL_PROFILE_PROJECTS_ID}
        onSelect={handleSelect}
      />
    </div>
  );
}
