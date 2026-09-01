import { useMemo } from "react";
import { ChevronsDown, ChevronsUp } from "lucide-react";
import styles from "./FileExplorer.module.css";

interface FileExplorerHeaderProps {
  rootPath: string;
  /** Max number of trailing segments to show; earlier ones are elided. */
  maxSegments?: number;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  canExpandAll?: boolean;
  canCollapseAll?: boolean;
}

export function FileExplorerHeader({
  rootPath,
  maxSegments = 4,
  onExpandAll,
  onCollapseAll,
  canExpandAll = true,
  canCollapseAll = true,
}: FileExplorerHeaderProps) {
  const segments = useMemo(() => {
    if (!rootPath) return [] as string[];
    const normalized = rootPath.replace(/\\+/g, "/");
    return normalized.split("/").filter(Boolean);
  }, [rootPath]);

  if (segments.length === 0) return null;

  const elided = segments.length > maxSegments;
  const visible = elided ? segments.slice(-maxSegments) : segments;

  return (
    <div
      className={styles.pathHeader}
      title={rootPath}
      aria-label={`Current directory: ${rootPath}`}
    >
      <span className={styles.pathCrumbs}>
        {elided && (
          <>
            <span className={styles.pathCrumb}>...</span>
            <span className={styles.pathSeparator}>/</span>
          </>
        )}
        {visible.map((seg, i) => {
          const isLast = i === visible.length - 1;
          return (
            <span key={`${seg}-${i}`}>
              <span
                className={isLast ? styles.pathCrumbLeaf : styles.pathCrumb}
              >
                {seg}
              </span>
              {!isLast && <span className={styles.pathSeparator}>/</span>}
            </span>
          );
        })}
      </span>
      {(onExpandAll || onCollapseAll) && (
        <span className={styles.pathActions}>
          {onExpandAll && (
            <button
              type="button"
              className={styles.pathActionButton}
              onClick={onExpandAll}
              disabled={!canExpandAll}
              title="Expand all folders"
              aria-label="Expand all folders"
            >
              <ChevronsDown size={13} aria-hidden="true" />
            </button>
          )}
          {onCollapseAll && (
            <button
              type="button"
              className={styles.pathActionButton}
              onClick={onCollapseAll}
              disabled={!canCollapseAll}
              title="Collapse all folders"
              aria-label="Collapse all folders"
            >
              <ChevronsUp size={13} aria-hidden="true" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
