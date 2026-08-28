import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ExternalLink,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";

import { api } from "../../api/client";
import type {
  SourceControlArea,
  SourceControlDiff,
  SourceControlFile,
  SourceControlStatus,
} from "../../api/client";
import { EmptyState } from "../EmptyState";
import styles from "./SourceControlWorkbench.module.css";

interface SourceControlWorkbenchProps {
  projectId: string;
  agentInstanceId?: string;
}

interface Selection {
  path: string;
  area: SourceControlArea;
}

const STATUS_LABELS: Record<string, string> = {
  "?": "Untracked",
  "!": "Ignored",
  A: "Added",
  C: "Copied",
  D: "Deleted",
  M: "Modified",
  R: "Renamed",
  T: "Type changed",
  U: "Unmerged",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Source-control action failed.";
}

function fileInArea(
  file: SourceControlFile,
  area: SourceControlArea,
): boolean {
  return area === "staged"
    ? Boolean(file.staged_status)
    : Boolean(file.worktree_status);
}

function firstSelection(status: SourceControlStatus): Selection | null {
  const worktreeFile = status.files.find((file) => file.worktree_status);
  if (worktreeFile) return { path: worktreeFile.path, area: "worktree" };
  const stagedFile = status.files.find((file) => file.staged_status);
  return stagedFile ? { path: stagedFile.path, area: "staged" } : null;
}

function selectionExists(
  status: SourceControlStatus,
  selection: Selection,
): boolean {
  return status.files.some(
    (file) => file.path === selection.path && fileInArea(file, selection.area),
  );
}

export function SourceControlWorkbench({
  projectId,
  agentInstanceId,
}: SourceControlWorkbenchProps) {
  const [status, setStatus] = useState<SourceControlStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<SourceControlDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setNotice(null);
    setRefreshKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    setStatusError(null);
    void api.sourceControl
      .getStatus(projectId, agentInstanceId)
      .then((nextStatus) => {
        if (cancelled) return;
        setStatus(nextStatus);
        setSelection((current) =>
          current && selectionExists(nextStatus, current)
            ? current
            : firstSelection(nextStatus),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatusError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentInstanceId, projectId, refreshKey]);

  useEffect(() => {
    if (!selection) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiff(null);
    setDiffLoading(true);
    void api.sourceControl
      .getDiff(projectId, selection.path, selection.area, agentInstanceId)
      .then((nextDiff) => {
        if (!cancelled) setDiff(nextDiff);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDiff({
          path: selection.path,
          area: selection.area,
          diff: errorMessage(error),
          truncated: false,
          binary: false,
        });
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentInstanceId, projectId, refreshKey, selection]);

  const stagedFiles = useMemo(
    () => status?.files.filter((file) => file.staged_status) ?? [],
    [status],
  );
  const worktreeFiles = useMemo(
    () => status?.files.filter((file) => file.worktree_status) ?? [],
    [status],
  );

  const mutateFiles = async (
    area: SourceControlArea,
    paths: string[],
  ) => {
    const action = area === "worktree" ? "stage" : "unstage";
    setPendingAction(`${action}:${paths.join("\u0000")}`);
    setNotice(null);
    try {
      if (area === "worktree") {
        await api.sourceControl.stage(projectId, paths, agentInstanceId);
      } else {
        await api.sourceControl.unstage(projectId, paths, agentInstanceId);
      }
      setNotice(
        `${paths.length === 1 ? paths[0] : `${paths.length} files`} ${
          area === "worktree" ? "staged" : "unstaged"
        }.`,
      );
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const createCommit = async () => {
    const message = commitMessage.trim();
    if (!message) return;
    setPendingAction("commit");
    setNotice(null);
    try {
      const result = await api.sourceControl.commit(
        projectId,
        message,
        agentInstanceId,
      );
      setCommitMessage("");
      setNotice(`Committed ${result.commit}.`);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  if (statusLoading && !status) {
    return (
      <div className={styles.loading} role="status">
        <RefreshCw className={styles.spinning} size={16} />
        Reading repository…
      </div>
    );
  }

  if (statusError && !status) {
    return (
      <EmptyState icon={<GitBranch size={22} />}>
        {statusError}
        <button type="button" className={styles.retryButton} onClick={refresh}>
          Try again
        </button>
      </EmptyState>
    );
  }

  if (!status?.available) {
    return (
      <EmptyState icon={<GitBranch size={22} />}>
        {status?.unavailable_reason ?? "This workspace is not a Git repository."}
      </EmptyState>
    );
  }

  return (
    <div className={styles.root} data-testid="source-control-workbench">
      <header className={styles.repositoryHeader}>
        <div className={styles.branchRow}>
          <div className={styles.branchName} title={status.branch ?? "Detached HEAD"}>
            <GitBranch size={14} />
            <span>{status.branch ?? "Detached HEAD"}</span>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={refresh}
            disabled={statusLoading || Boolean(pendingAction)}
            aria-label="Refresh source control"
            title="Refresh source control"
          >
            <RefreshCw className={statusLoading ? styles.spinning : undefined} size={14} />
          </button>
        </div>
        <div className={styles.syncRow}>
          <span className={styles.upstream} title={status.upstream}>
            {status.upstream ?? "No upstream"}
          </span>
          <span className={styles.syncCount} title={`${status.ahead} commits ahead`}>
            <ArrowUp size={12} /> {status.ahead}
          </span>
          <span className={styles.syncCount} title={`${status.behind} commits behind`}>
            <ArrowDown size={12} /> {status.behind}
          </span>
        </div>
        {status.pull_request ? (
          <a
            className={styles.pullRequest}
            href={status.pull_request.url}
            target="_blank"
            rel="noopener noreferrer"
            title={status.pull_request.title}
          >
            <span>PR #{status.pull_request.number}</span>
            <span className={styles.pullRequestTitle}>{status.pull_request.title}</span>
            <ExternalLink size={12} />
          </a>
        ) : null}
      </header>

      <div className={styles.changesPane}>
        <FileGroup
          title="Staged changes"
          files={stagedFiles}
          area="staged"
          selection={selection}
          pendingAction={pendingAction}
          onSelect={setSelection}
          onMutate={mutateFiles}
        />

        <div className={styles.commitBox}>
          <textarea
            className={styles.commitInput}
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void createCommit();
              }
            }}
            placeholder="Commit message"
            aria-label="Commit message"
            rows={2}
          />
          <button
            type="button"
            className={styles.commitButton}
            onClick={() => void createCommit()}
            disabled={
              stagedFiles.length === 0 ||
              !commitMessage.trim() ||
              Boolean(pendingAction)
            }
          >
            <Check size={13} />
            {pendingAction === "commit" ? "Committing…" : "Commit"}
          </button>
        </div>

        <FileGroup
          title="Changes"
          files={worktreeFiles}
          area="worktree"
          selection={selection}
          pendingAction={pendingAction}
          onSelect={setSelection}
          onMutate={mutateFiles}
        />
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      </div>

      <section className={styles.diffPane} aria-label="Source-control diff">
        {selection ? (
          <>
            <div className={styles.diffHeader} title={selection.path}>
              <span>{selection.path}</span>
              <span className={styles.areaBadge}>
                {selection.area === "staged" ? "INDEX" : "WORKTREE"}
              </span>
            </div>
            <DiffView loading={diffLoading} diff={diff} />
          </>
        ) : (
          <div className={styles.cleanState}>
            <Check size={18} />
            Working tree clean
          </div>
        )}
      </section>
    </div>
  );
}

interface FileGroupProps {
  title: string;
  files: SourceControlFile[];
  area: SourceControlArea;
  selection: Selection | null;
  pendingAction: string | null;
  onSelect: (selection: Selection) => void;
  onMutate: (area: SourceControlArea, paths: string[]) => Promise<void>;
}

function FileGroup({
  title,
  files,
  area,
  selection,
  pendingAction,
  onSelect,
  onMutate,
}: FileGroupProps) {
  const verb = area === "worktree" ? "Stage" : "Unstage";
  return (
    <section className={styles.fileGroup}>
      <div className={styles.groupHeader}>
        <span>{title}</span>
        <span className={styles.fileCount}>{files.length}</span>
        {files.length > 1 ? (
          <button
            type="button"
            className={styles.groupAction}
            onClick={() =>
              void onMutate(
                area,
                Array.from(
                  new Set(
                    files.flatMap((file) =>
                      file.original_path
                        ? [file.path, file.original_path]
                        : [file.path],
                    ),
                  ),
                ),
              )
            }
            disabled={Boolean(pendingAction)}
          >
            {verb} all
          </button>
        ) : null}
      </div>
      {files.length === 0 ? (
        <div className={styles.emptyGroup}>No {title.toLowerCase()}</div>
      ) : (
        files.map((file) => {
          const status =
            area === "staged" ? file.staged_status : file.worktree_status;
          const selected =
            selection?.path === file.path && selection.area === area;
          return (
            <div
              key={`${area}:${file.path}`}
              className={`${styles.fileRow}${selected ? ` ${styles.fileRowSelected}` : ""}`}
            >
              <button
                type="button"
                className={styles.fileSelect}
                onClick={() => onSelect({ path: file.path, area })}
                title={file.original_path ? `${file.original_path} → ${file.path}` : file.path}
              >
                <span className={styles.statusCode} title={STATUS_LABELS[status ?? ""] ?? status}>
                  {status}
                </span>
                <span className={styles.filePath}>
                  {file.original_path ? (
                    <span className={styles.originalPath}>{file.original_path} → </span>
                  ) : null}
                  {file.path}
                </span>
              </button>
              <button
                type="button"
                className={styles.fileAction}
                onClick={() =>
                  void onMutate(
                    area,
                    file.original_path
                      ? [file.path, file.original_path]
                      : [file.path],
                  )
                }
                disabled={Boolean(pendingAction)}
                aria-label={`${verb} ${file.path}`}
                title={`${verb} ${file.path}`}
              >
                {area === "worktree" ? <Plus size={13} /> : <Minus size={13} />}
              </button>
            </div>
          );
        })
      )}
    </section>
  );
}

function DiffView({
  loading,
  diff,
}: {
  loading: boolean;
  diff: SourceControlDiff | null;
}) {
  if (loading) {
    return <div className={styles.diffMessage}>Loading diff…</div>;
  }
  if (!diff) {
    return <div className={styles.diffMessage}>Select a changed file.</div>;
  }
  if (diff.binary && !diff.diff) {
    return <div className={styles.diffMessage}>Binary file changed.</div>;
  }
  if (!diff.diff) {
    return <div className={styles.diffMessage}>No textual diff available.</div>;
  }
  return (
    <pre className={styles.diff} tabIndex={0}>
      <code>
        {diff.diff.split("\n").map((line, index) => {
          const kind = line.startsWith("+") && !line.startsWith("+++")
            ? styles.addition
            : line.startsWith("-") && !line.startsWith("---")
              ? styles.deletion
              : line.startsWith("@@")
                ? styles.hunk
                : line.startsWith("diff ") ||
                    line.startsWith("index ") ||
                    line.startsWith("---") ||
                    line.startsWith("+++")
                  ? styles.diffMeta
                  : undefined;
          return (
            <span className={kind} key={`${index}:${line}`}>
              {line || " "}
              {"\n"}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
