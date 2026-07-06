import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@cypher-asi/zui";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import {
  isFolderPromptPending,
  settleFolderPrompt,
} from "../../../../features/onboarding/folder-prompt-storage";
import styles from "./ProjectFolderPrompt.module.css";

/**
 * One-shot desktop banner shown at the top of the Chat app after a first-run
 * user picks the "Just Start" onboarding lane. Offers to open a project
 * folder (via the existing New Project modal, whose workspace picker links a
 * local folder); either action settles the localStorage flag so the banner
 * never reappears. Renders nothing on web — there is no local filesystem to
 * link without the desktop bridge.
 */
export function ProjectFolderPrompt(): React.ReactElement | null {
  const { hasDesktopBridge } = useAuraCapabilities();
  const openNewProjectModal = useProjectsListStore((s) => s.openNewProjectModal);
  const [visible, setVisible] = useState(isFolderPromptPending);

  if (!hasDesktopBridge || !visible) return null;

  function dismiss(): void {
    settleFolderPrompt();
    setVisible(false);
  }

  return (
    <div className={styles.banner} role="status">
      <span className={styles.icon} aria-hidden="true">
        <FolderOpen size={16} />
      </span>
      <span className={styles.message}>
        Open a project folder to give your agent access to your codebase.
      </span>
      <div className={styles.actions}>
        <Button
          type="button"
          variant="primary"
          dimUnselected={false}
          className={styles.actionBtn}
          onClick={() => {
            dismiss();
            openNewProjectModal();
          }}
        >
          Open Folder
        </Button>
        <Button
          type="button"
          variant="ghost"
          dimUnselected={false}
          className={styles.actionBtn}
          onClick={dismiss}
        >
          Maybe later
        </Button>
      </div>
    </div>
  );
}
