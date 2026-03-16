import { useMemo, useCallback } from "react";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Globe, FolderOpen } from "lucide-react";
import { useProfile } from "./ProfileProvider";
import styles from "./ProfileList.module.css";

export function ProfileList() {
  const { projects, selectedProject, setSelectedProject } = useProfile();

  const data: ExplorerNode[] = useMemo(
    () => [
      { id: "__all__", label: "All", icon: <Globe size={14} /> },
      ...projects.map((p) => ({
        id: p.id,
        label: p.name,
        icon: <FolderOpen size={14} />,
      })),
    ],
    [projects],
  );

  const defaultSelectedIds = useMemo(
    () => [selectedProject ?? "__all__"],
    [selectedProject],
  );

  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[ids.length - 1];
      if (!id) return;
      setSelectedProject(id === "__all__" ? null : id);
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
