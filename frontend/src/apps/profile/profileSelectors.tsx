import type { ReactNode } from "react";
import { FolderOpen, Globe } from "lucide-react";
import type { ProfileProject } from "../../stores/profile-store";

export const ALL_PROFILE_PROJECTS_ID = "__all__";

export function getProfileSelectorItems(projects: ProfileProject[]): { id: string; label: string; icon: ReactNode }[] {
  return [
    { id: ALL_PROFILE_PROJECTS_ID, label: "All", icon: <Globe size={14} /> },
    ...projects.map((project) => ({
      id: project.id,
      label: project.name,
      icon: <FolderOpen size={14} />,
    })),
  ];
}
