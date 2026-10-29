import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { api, ApiClientError } from "../../api/client";
import type {
  SourceControlArea,
  SourceControlDiff,
  SourceControlFile,
  SourceControlStatus,
} from "../../api/client";
import { EmptyState } from "../EmptyState";
import { useViewedFiles } from "./use-viewed-files";
import { viewedFileKey } from "../../shared/lib/source-control-viewed-files";
import styles from "./SourceControlWorkbench.module.css";
import { findDiffMatches } from "./diff-search";
import { filterReviewFiles } from "./review-files";

interface SourceControlWorkbenchProps {
  projectId: string;
  agentInstanceId?: string;
  remoteAgentId?: string;
  remoteWorkspacePath?: string;
  /** Review-only mode for mobile: status and diffs without repository mutations. */
  readOnly?: boolean;
  /**
   * Optional review handoff. When present, changed diff lines become explicit
   * actions that can be sent back to the owning conversation without making
   * the source-control surface responsible for chat routing or draft state.
   */
  onDiscussChange?: (context: SourceControlReviewContext) => void;
}

export interface SourceControlReviewContext {
  path: string;
  area: SourceControlArea;
  line: string;
  oldLine: number | null;
  newLine: number | null;
}

interface Selection {
  path: string;
  area: SourceControlArea;
}
const EMPTY_FILES: SourceControlFile[] = [];

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

function errorMessage(error: unknown, remote = false): string {
  if (remote && error instanceof ApiClientError) {
    if (error.status === 404) return "Remote changes are unavailable for this agent. Update its environment or refresh the workspace.";
    if (error.status === 503 || error.status === 502 || error.status === 504) return "The remote agent is offline. Its saved conversation is still available.";
    if (error.status === 403) return "Access to this remote workspace was denied.";
  }
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
  const files = filterReviewFiles(status.files, "", false);
  const worktreeFile = files.find((file) => file.worktree_status);
  if (worktreeFile) return { path: worktreeFile.path, area: "worktree" };
  const stagedFile = files.find((file) => file.staged_status);
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

export function SourceControlWorkbench(props: SourceControlWorkbenchProps) {
  // A refresh should retain review context, but a different workspace must not
  // inherit the previous workspace's selected file or unsent commit message.
  const workspaceKey = JSON.stringify([
    props.projectId,
    props.agentInstanceId,
    props.remoteAgentId,
    props.remoteWorkspacePath,
  ]);
  return <WorkspaceSourceControl key={workspaceKey} {...props} />;
}

function WorkspaceSourceControl({
  projectId,
  agentInstanceId,
  remoteAgentId,
  remoteWorkspacePath,
  readOnly = false,
  onDiscussChange,
}: SourceControlWorkbenchProps) {
  const [status, setStatus] = useState<SourceControlStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<SourceControlDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffRequestKey, setDiffRequestKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fileQuery, setFileQuery] = useState("");
  const [hideTests, setHideTests] = useState(false);
  const effectiveReadOnly = readOnly || Boolean(remoteAgentId);
  const loadDiff = useCallback((path: string, area: SourceControlArea) =>
    remoteAgentId && remoteWorkspacePath
      ? api.swarm.getRemoteGitDiff(remoteAgentId, remoteWorkspacePath, path, area)
      : api.sourceControl.getDiff(projectId, path, area, agentInstanceId),
  [projectId, agentInstanceId, remoteAgentId, remoteWorkspacePath]);
  const reviewScope = status?.available ? JSON.stringify([
    projectId, agentInstanceId, remoteAgentId, remoteWorkspacePath,
    status.branch, status.pull_request?.url,
  ]) : null;
  const viewed = useViewedFiles(reviewScope, status?.files ?? EMPTY_FILES,
    !diffLoading && !diffError && !statusLoading && diff?.path === selection?.path && diff?.area === selection?.area ? diff : null,
    refreshKey, loadDiff);

  const refresh = useCallback(() => {
    setNotice(null);
    setRefreshKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    setStatusError(null);
    setStatus(null);
    setDiff(null);
    const request = remoteAgentId
      ? remoteWorkspacePath
        ? api.swarm.getRemoteGitStatus(remoteAgentId, remoteWorkspacePath)
        : Promise.resolve<SourceControlStatus>({
            available: false,
            unavailable_reason: "The remote agent has not exposed a live workspace yet.",
            ahead: 0,
            behind: 0,
            files: [],
          })
      : api.sourceControl.getStatus(projectId, agentInstanceId);
    void request
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
        setStatusError(errorMessage(error, Boolean(remoteAgentId)));
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentInstanceId, projectId, refreshKey, remoteAgentId, remoteWorkspacePath]);

  useEffect(() => {
    if (!selection) {
      setDiff(null);
      setDiffError(null);
      setDiffLoading(false);
      return;
    }
    let cancelled = false;
    setDiff(null);
    setDiffLoading(true);
    setDiffError(null);
    const request = remoteAgentId && remoteWorkspacePath
      ? api.swarm.getRemoteGitDiff(remoteAgentId, remoteWorkspacePath, selection.path, selection.area)
      : api.sourceControl.getDiff(projectId, selection.path, selection.area, agentInstanceId);
    void request
      .then((nextDiff) => {
        if (!cancelled) setDiff(nextDiff);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDiffError(errorMessage(error, Boolean(remoteAgentId)));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentInstanceId, projectId, refreshKey, diffRequestKey, remoteAgentId, remoteWorkspacePath, selection]);

  const stagedFiles = useMemo(
    () => status?.files.filter((file) => file.staged_status) ?? [],
    [status],
  );
  const worktreeFiles = useMemo(
    () => status?.files.filter((file) => file.worktree_status) ?? [],
    [status],
  );
  const visibleStaged = useMemo(() => filterReviewFiles(stagedFiles, fileQuery, hideTests), [stagedFiles, fileQuery, hideTests]);
  const visibleWorktree = useMemo(() => filterReviewFiles(worktreeFiles, fileQuery, hideTests), [worktreeFiles, fileQuery, hideTests]);
  const visibleSelections = [...visibleStaged.map((file): Selection => ({ path: file.path, area: "staged" })),
    ...visibleWorktree.map((file): Selection => ({ path: file.path, area: "worktree" }))];
  const visibleIndex = visibleSelections.findIndex((file) => file.path === selection?.path && file.area === selection.area);
  const filtersActive = Boolean(fileQuery.trim()) || hideTests;
  const clearFileFilters = () => { setFileQuery(""); setHideTests(false); };
  const navigateFile = (direction: number) => {
    if (!visibleSelections.length) return;
    const index = visibleIndex < 0 ? (direction > 0 ? 0 : visibleSelections.length - 1)
      : (visibleIndex + direction + visibleSelections.length) % visibleSelections.length;
    setSelection(visibleSelections[index]);
  };

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
    <div
      className={styles.root}
      data-testid="source-control-workbench"
      data-source-control-mode={effectiveReadOnly ? "review" : "manage"}
    >
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

      <div className={styles.reviewProgress} aria-live="polite">
        {viewed.marks.size} / {stagedFiles.length + worktreeFiles.length} viewed in Aura
        <span>Local review marks · Restored marks are rechecked against current changes</span>
      </div>

      <div className={styles.changesPane}>
        <div className={styles.fileFilters} role="group" aria-label="Changed file filters">
          <input type="search" aria-label="Filter changed files" placeholder="Filter changed files"
            value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} />
          <button type="button" aria-pressed={hideTests} onClick={() => setHideTests((value) => !value)}
            title="Also hides fixtures, mocks, and snapshots">Hide tests</button>
          {filtersActive ? <button type="button" onClick={clearFileFilters}>Clear file filters</button> : null}
        </div>
        {filtersActive ? <div className={styles.filterNotice} role="status">
          Showing {visibleStaged.length + visibleWorktree.length} of {stagedFiles.length + worktreeFiles.length} changed entries.
          {stagedFiles.length > visibleStaged.length ? ` ${stagedFiles.length - visibleStaged.length} staged entries are hidden; a commit still includes all staged changes.` : ""}
        </div> : null}
        <FileGroup
          title="Staged changes"
          viewedMarks={viewed.marks}
          files={visibleStaged}
          filtered={filtersActive}
          area="staged"
          selection={selection}
          pendingAction={pendingAction}
          onSelect={setSelection}
          onMutate={effectiveReadOnly ? undefined : mutateFiles}
        />

        {!effectiveReadOnly ? (
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
        ) : null}

        <FileGroup
          title="Changes"
          viewedMarks={viewed.marks}
          files={visibleWorktree}
          filtered={filtersActive}
          area="worktree"
          selection={selection}
          pendingAction={pendingAction}
          onSelect={setSelection}
          onMutate={effectiveReadOnly ? undefined : mutateFiles}
        />
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      </div>

      <section className={styles.diffPane} aria-label="Source-control diff">
        {selection ? (
          <>
            <div className={styles.fileNavigation} aria-label="Changed file navigation" role="group">
              <button type="button" aria-label="Previous changed file" onClick={() => navigateFile(-1)}
                disabled={!visibleSelections.length || (visibleSelections.length === 1 && visibleIndex === 0)}><ArrowLeft size={14} /></button>
              <span>{visibleIndex >= 0 ? `${visibleIndex + 1} / ${visibleSelections.length}` : "Selected file hidden by filters"}</span>
              <button type="button" aria-label="Next changed file" onClick={() => navigateFile(1)}
                disabled={!visibleSelections.length || (visibleSelections.length === 1 && visibleIndex === 0)}><ArrowRight size={14} /></button>
              {visibleIndex < 0 ? <button type="button" onClick={clearFileFilters}>Show selected file</button> : null}
            </div>
            <div className={styles.diffHeader} title={selection.path}>
              <span>{selection.path}</span>
              <span className={styles.areaBadge}>
                {selection.area === "staged" ? "INDEX" : "WORKTREE"}
              </span>
              <label className={styles.viewedToggle} title="Review state is local to Aura, not synced to GitHub. Complete text diffs only.">
                <input type="checkbox" checked={viewed.viewed} disabled={!viewed.canToggle}
                  onChange={viewed.toggle} aria-label={`Viewed ${selection.path} (${selection.area})`} />
                Viewed
              </label>
            </div>
            {diff && !diffLoading && !diffError && (diff.truncated || diff.binary) ? (
              <div className={styles.diffMessage}>Viewed marks require a complete text diff. Binary and truncated diffs cannot be marked viewed.</div>
            ) : null}
            {diffError ? <div className={styles.diffMessage} role="alert">
              <p>Could not load this diff.</p>
              <p>{diffError}</p>
              <button type="button" className={styles.retryButton}
                onClick={() => setDiffRequestKey((key) => key + 1)}>
                Retry diff
              </button>
            </div> : <DiffView
              loading={diffLoading}
              diff={diff}
              onDiscussChange={onDiscussChange}
            />}
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
  filtered: boolean;
  viewedMarks: Map<string, string>;
  title: string;
  files: SourceControlFile[];
  area: SourceControlArea;
  selection: Selection | null;
  pendingAction: string | null;
  onSelect: (selection: Selection) => void;
  onMutate?: (area: SourceControlArea, paths: string[]) => Promise<void>;
}

function FileGroup({
  filtered,
  viewedMarks,
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
        {files.length > 1 && onMutate ? (
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
            {verb} {filtered ? "visible" : "all"}
          </button>
        ) : null}
      </div>
      {files.length === 0 ? (
        <div className={styles.emptyGroup}>{filtered ? `No matching ${title.toLowerCase()}` : `No ${title.toLowerCase()}`}</div>
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
                {viewedMarks.has(viewedFileKey(file.path, area)) ? <Check size={13} aria-label="Viewed in Aura" /> : null}
              </button>
              {onMutate ? (
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
              ) : null}
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
  onDiscussChange,
}: {
  loading: boolean;
  diff: SourceControlDiff | null;
  onDiscussChange?: (context: SourceControlReviewContext) => void;
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
    <SearchableDiff
      key={JSON.stringify([diff.path, diff.area])}
      diff={diff}
      onDiscussChange={onDiscussChange}
    />
  );
}

function SearchableDiff({ diff, onDiscussChange }: {
  diff: SourceControlDiff;
  onDiscussChange?: (context: SourceControlReviewContext) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLElement>(null);
  const findButtonRef = useRef<HTMLButtonElement>(null);
  const lines = useMemo(() => parseReviewableDiffLines(diff.diff), [diff.diff]);
  const { matches, limited } = useMemo(
    () => findDiffMatches(lines.map(({ line }) => line), searchOpen ? query : ""),
    [lines, query, searchOpen],
  );
  const matchesByLine = useMemo(() => {
    const result = new Map<number, { start: number; end: number; index: number }[]>();
    matches.forEach((match, index) => {
      const entries = result.get(match.line) ?? [];
      entries.push({ ...match, index });
      result.set(match.line, entries);
    });
    return result;
  }, [matches]);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [matches, activeIndex]);

  const moveMatch = (direction: 1 | -1) => {
    if (matches.length) {
      setActiveIndex((current) => (current + direction + matches.length) % matches.length);
    }
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setActiveIndex(0);
    findButtonRef.current?.focus();
  };
  const highlight = (line: string, lineIndex: number) => {
    const segments = [];
    let cursor = 0;
    for (const match of matchesByLine.get(lineIndex) ?? []) {
      segments.push(line.slice(cursor, match.start));
      segments.push(
        <mark
          key={match.start}
          ref={match.index === activeIndex ? activeRef : undefined}
          className={match.index === activeIndex ? styles.activeMatch : styles.searchMatch}
          aria-current={match.index === activeIndex ? "true" : undefined}
        >
          {line.slice(match.start, match.end)}
        </mark>,
      );
      cursor = match.end;
    }
    segments.push(line.slice(cursor));
    return segments;
  };

  return (
    <div className={styles.searchableDiff} onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (searchOpen && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
      }
    }}>
      <div className={styles.diffSearch}>
        {searchOpen ? <>
          <input
            ref={inputRef}
            className={styles.searchInput}
            aria-label="Find in diff"
            placeholder="Find in loaded diff…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                moveMatch(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <span className={styles.matchCount} role="status">
            {query ? matches.length ? `${activeIndex + 1} of ${matches.length}${limited ? "+" : ""}` : "No matches" : "Type to search"}
          </span>
          <button type="button" className={styles.iconButton} disabled={!matches.length}
            aria-label="Previous diff match" onClick={() => moveMatch(-1)}>
            <ChevronUp size={14} />
          </button>
          <button type="button" className={styles.iconButton} disabled={!matches.length}
            aria-label="Next diff match" onClick={() => moveMatch(1)}>
            <ChevronDown size={14} />
          </button>
          <button type="button" className={styles.iconButton}
            aria-label="Close diff search" onClick={closeSearch}>
            <X size={14} />
          </button>
        </> : null}
        <button ref={findButtonRef} type="button" className={styles.iconButton}
          aria-label="Find in diff" aria-keyshortcuts="Control+f Meta+f"
          title="Find in diff (Ctrl/Cmd+F)"
          onClick={() => { setSearchOpen(true); inputRef.current?.focus(); }}>
          <Search size={14} />
        </button>
      </div>
      {diff.truncated ? <div className={styles.searchScope}>Diff truncated. Only the loaded portion is shown and searched.</div> : null}
      {limited ? <div className={styles.searchScope}>Showing the first 1,000 matches. Refine your search to see others.</div> : null}
    <pre className={styles.diff} tabIndex={0}>
      <code>
        {lines.map(({ line, oldLine, newLine }, index) => {
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
          const reviewable = Boolean(onDiscussChange) && (oldLine !== null || newLine !== null)
            && (line.startsWith("+") || line.startsWith("-"));
          const lineLabel = newLine !== null
            ? `new line ${newLine}`
            : `old line ${oldLine}`;
          if (reviewable) {
            return (
              <button
                type="button"
                className={`${styles.diffLineButton}${kind ? ` ${kind}` : ""}`}
                key={`${index}:${line}`}
                onClick={() => onDiscussChange?.({
                  path: diff.path,
                  area: diff.area,
                  line,
                  oldLine,
                  newLine,
                })}
                aria-label={`Ask agent about ${diff.path} ${lineLabel}`}
                title={`Ask agent about ${lineLabel}`}
              >
                {line ? highlight(line, index) : " "}
              </button>
            );
          }
          return (
            <span className={`${styles.diffLine}${kind ? ` ${kind}` : ""}`} key={`${index}:${line}`}>
              {line ? highlight(line, index) : " "}
              {"\n"}
            </span>
          );
        })}
      </code>
    </pre>
    </div>
  );
}

interface ParsedDiffLine {
  line: string;
  oldLine: number | null;
  newLine: number | null;
}

/** Track unified-diff hunk positions so review actions cite source lines. */
function parseReviewableDiffLines(diff: string): ParsedDiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  return diff.split("\n").map((line) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      return { line, oldLine: null, newLine: null };
    }
    if (!inHunk || line.startsWith("\\ No newline")) {
      return { line, oldLine: null, newLine: null };
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const result = { line, oldLine: null, newLine };
      newLine += 1;
      return result;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      const result = { line, oldLine, newLine: null };
      oldLine += 1;
      return result;
    }
    const result = { line, oldLine, newLine };
    oldLine += 1;
    newLine += 1;
    return result;
  });
}
