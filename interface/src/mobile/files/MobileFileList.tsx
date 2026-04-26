import type { ExplorerNode } from "@cypher-asi/zui";
import { api } from "../../api/client";
import type { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import styles from "../../components/FileExplorer/FileExplorer.module.css";

function getMobilePreviewLabel(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "PDF";
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lower)) return "Image";
  if (/\.(md|markdown)$/.test(lower)) return "Read";
  if (
    /\.(rs|ts|tsx|js|jsx|json|yaml|yml|toml|css|html|txt|sh|py|go|java|sql)$/.test(
      lower,
    )
  )
    return "Code";
  return "Preview";
}

interface MobileFileListProps {
  nodes: ExplorerNode[];
  features: ReturnType<typeof useAuraCapabilities>["features"];
  isRemote: boolean;
  onFileSelect?: (path: string) => void;
  rootPath?: string;
}

export function MobileFileList({
  nodes,
  features,
  isRemote,
  onFileSelect,
  rootPath,
}: MobileFileListProps) {
  return (
    <div className={styles.mobileScrollContainer}>
      <div className={styles.mobileFileList}>
        <MobileNodes
          nodes={nodes}
          features={features}
          isRemote={isRemote}
          onFileSelect={onFileSelect}
          rootPath={rootPath}
          depth={0}
        />
      </div>
    </div>
  );
}

function MobileNodes({
  nodes,
  features,
  isRemote,
  onFileSelect,
  rootPath,
  depth,
}: MobileFileListProps & { depth: number }) {
  return (
    <>
      {nodes.map((node) => {
        const isDir =
          Boolean(node.children?.length) || node.metadata?.is_dir === true;
        const canPreviewFile = !isDir && Boolean(onFileSelect);
        const canOpenFile =
          !isDir && (canPreviewFile || (features.ideIntegration && !isRemote));
        const depthPadding = { paddingLeft: `${12 + depth * 16}px` };
        const actionLabel = canPreviewFile
          ? getMobilePreviewLabel(node.label)
          : canOpenFile
            ? "Open"
            : isDir
              ? "Folder"
              : "File";

        const content = (
          <div className={styles.mobileRowMain}>
            {node.icon}
            <span className={styles.truncatedLabel}>{node.label}</span>
          </div>
        );

        return (
          <div key={node.id} className={styles.mobileNodeGroup}>
            {canOpenFile ? (
              <button
                type="button"
                className={styles.mobileRow}
                style={{ ...depthPadding, cursor: "pointer" }}
                onClick={() => {
                  if (onFileSelect) {
                    onFileSelect(node.id);
                  } else {
                    api.openIde(node.id, rootPath);
                  }
                }}
              >
                {content}
                <span className={styles.mobileRowMeta}>{actionLabel}</span>
              </button>
            ) : (
              <div className={styles.mobileRow} style={depthPadding}>
                {content}
                <span className={styles.mobileRowMeta}>{actionLabel}</span>
              </div>
            )}
            {node.children?.length ? (
              <MobileNodes
                nodes={node.children}
                features={features}
                isRemote={isRemote}
                onFileSelect={onFileSelect}
                rootPath={rootPath}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
