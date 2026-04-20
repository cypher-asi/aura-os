import { useMemo } from "react";
import styles from "./FileExplorer.module.css";

interface FileExplorerHeaderProps {
  rootPath: string;
  /** Max number of trailing segments to show; earlier ones are elided. */
  maxSegments?: number;
}

export function FileExplorerHeader({
  rootPath,
  maxSegments = 4,
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
    </div>
  );
}
