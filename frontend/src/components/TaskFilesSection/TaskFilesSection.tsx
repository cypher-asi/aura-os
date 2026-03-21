import { Text, GroupCollapsible, Item } from "@cypher-asi/zui";
import { FilePlus, FilePen, FileX } from "lucide-react";
import { api } from "../../api/client";
import { useProjectContext } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { getLinkedWorkspaceRoot } from "../../utils/projectWorkspace";
import styles from "../Preview/Preview.module.css";

function FileOpIcon({ op }: { op: string }) {
  if (op === "create") return <FilePlus size={12} className={styles.opCreate} />;
  if (op === "modify") return <FilePen size={12} className={styles.opModify} />;
  if (op === "delete") return <FileX size={12} className={styles.opDelete} />;
  return <FilePen size={12} />;
}

export function TaskFilesSection({ fileOps }: { fileOps: { op: string; path: string }[] }) {
  const ctx = useProjectContext();
  const { features } = useAuraCapabilities();

  if (fileOps.length === 0) return null;

  const linkedWorkspaceRoot = getLinkedWorkspaceRoot(ctx?.project);
  const canOpenChangedFiles = features.ideIntegration && Boolean(linkedWorkspaceRoot);

  return (
    <GroupCollapsible label="Files Changed" count={fileOps.length} defaultOpen className={styles.section}>
      <div className={styles.fileOpsList}>
        {fileOps.map((f) => {
          const fullPath = linkedWorkspaceRoot ? `${linkedWorkspaceRoot}/${f.path}` : null;
          return (
            <Item
              key={f.path}
              onClick={canOpenChangedFiles && fullPath ? () => api.openIde(fullPath) : undefined}
              className={styles.fileOpItem}
            >
              <Item.Icon><FileOpIcon op={f.op} /></Item.Icon>
              <Item.Label>{f.path}</Item.Label>
            </Item>
          );
        })}
      </div>
      {!canOpenChangedFiles && (
        <Text variant="muted" size="sm" className={styles.filesHint}>
          Open changed files from a linked desktop workspace.
        </Text>
      )}
    </GroupCollapsible>
  );
}
