import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import hljs from "highlight.js/lib/common";
import { api } from "../../api/client";
import { langFromPath } from "../../ide/lang";
import type { HostedWorkspaceTarget } from "../../shared/api/hosted-workspace";
import { ApiClientError } from "../../shared/api/core";
import {
  MAX_WEB_FILE_WRITE_BYTES,
  utf8ByteLength,
  type WorkspaceFileReadResult,
  type WorkspaceFileWriteResult,
} from "../../shared/api/workspace-files";

const MAX_HIGHLIGHT_SIZE = 100_000;
const MAX_CLOSED_TABS = 10;

export interface TabState {
  path: string;
  content: string | null;
  savedContent: string | null;
  loading: boolean;
  error: string | null;
  revision: string | null;
}

interface ClosedTab {
  path: string;
  index: number;
  draft: TabState | null;
}

export function useIdeViewTabs(
  initialFile: string,
  remoteAgentId?: string,
  hostedWorkspace?: HostedWorkspaceTarget,
) {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // In-memory only: closing the workspace must not persist source or drafts.
  const [closedTabs, setClosedTabs] = useState<ClosedTab[]>([]);
  const openRequests = useRef(new Map<string, symbol>());

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const openTab = useCallback((path: string) => {
    setSaveError(null);
    setClosedTabs((prev) => prev.filter((tab) => tab.path !== path));
    if (!openRequests.current.has(path)) {
      const request = Symbol(path);
      openRequests.current.set(path, request);
      const newTab: TabState = {
        path,
        content: null,
        savedContent: null,
        loading: true,
        error: null,
        revision: null,
      };
      setTabs((prev) => prev.some((tab) => tab.path === path) ? prev : [...prev, newTab]);
      const readPromise: Promise<WorkspaceFileReadResult> = hostedWorkspace
        ? api.hostedWorkspace.readFile(hostedWorkspace, path)
        : remoteAgentId
          ? api.swarm.readRemoteFile(remoteAgentId, path)
          : api.readFile(path);
      readPromise
        .then((res) => {
          if (openRequests.current.get(path) !== request) return;
          setTabs((prev2) => prev2.map((t) => {
            if (t.path !== path) return t;
            return res.ok && res.content != null
              ? {
                  ...t,
                  content: res.content,
                  savedContent: res.content,
                  loading: false,
                  revision: res.revision ?? null,
                }
              : { ...t, error: res.error ?? "Failed to read file", loading: false };
          }));
        })
        .catch((e) => {
          if (openRequests.current.get(path) !== request) return;
          setTabs((prev2) => prev2.map((t) => t.path !== path ? t : { ...t, error: String(e), loading: false }));
        });
    }
    setActiveTabPath(path);
  }, [hostedWorkspace, remoteAgentId]);

  const closeTab = useCallback((path: string) => {
    const index = tabs.findIndex((tab) => tab.path === path);
    const tab = tabs[index];
    if (!tab) return;
    openRequests.current.delete(path);
    const hasDraft = tab.content !== null && tab.savedContent !== null && tab.content !== tab.savedContent;
    setClosedTabs((prev) => [
      { path, index, draft: hasDraft ? tab : null },
      ...prev.filter((entry) => entry.path !== path),
    ].slice(0, MAX_CLOSED_TABS));
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      const newTabs = prev.filter((t) => t.path !== path);
      if (path === activeTabPath) {
        setActiveTabPath(newTabs.length === 0 ? null : newTabs[Math.min(idx, newTabs.length - 1)].path);
      }
      return newTabs;
    });
  }, [activeTabPath, tabs]);

  const reopenClosedTab = useCallback(() => {
    const entry = closedTabs[0];
    if (!entry) return;
    if (!entry.draft) {
      // Clean files are read again, so an agent's intervening edits are visible.
      openTab(entry.path);
      return;
    }
    openRequests.current.set(entry.path, Symbol(entry.path));
    setTabs((prev) => {
      if (prev.some((tab) => tab.path === entry.path)) return prev;
      const next = [...prev];
      next.splice(Math.min(entry.index, next.length), 0, entry.draft!);
      return next;
    });
    setClosedTabs((prev) => prev.filter((tab) => tab.path !== entry.path));
    setActiveTabPath(entry.path);
    setSaveError(null);
  }, [closedTabs, openTab]);

  useEffect(() => {
    if (initialFile) openTab(initialFile);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;
  const requiresWorkspaceRevision = Boolean(hostedWorkspace || remoteAgentId);
  const readOnly = Boolean(
    requiresWorkspaceRevision
      && activeTab
      && !activeTab.loading
      && activeTab.revision === null,
  );
  const readOnlyReason = readOnly
    ? "This workspace runtime must be updated before Aura Web can save files."
    : null;
  const dirty = activeTab != null && activeTab.content !== null && activeTab.savedContent !== null && activeTab.content !== activeTab.savedContent;
  const language = activeTab ? langFromPath(activeTab.path) ?? null : null;
  const activeContent = activeTab?.content ?? null;

  const handleContentChange = useCallback((newContent: string) => {
    if (readOnly) return;
    setTabs((prev) => prev.map((t) => t.path !== activeTabPath ? t : { ...t, content: newContent }));
  }, [activeTabPath, readOnly]);

  const handleSave = useCallback(async () => {
    if (!activeTab || activeTab.content == null || saving) return;
    if (readOnly) {
      setSaveError(readOnlyReason);
      return;
    }
    const tabPath = activeTab.path;
    const tabContent = activeTab.content;
    const openRequest = openRequests.current.get(tabPath);
    const isWebWorkspace = Boolean(hostedWorkspace || remoteAgentId);
    if (isWebWorkspace && !activeTab.revision) {
      setSaveError("This workspace runtime must be updated before Aura Web can save files.");
      return;
    }
    if (isWebWorkspace && utf8ByteLength(tabContent) > MAX_WEB_FILE_WRITE_BYTES) {
      setSaveError("Files larger than 700 KiB cannot be edited in Aura Web.");
      return;
    }
    setSaving(true); setSaveError(null);
    try {
      const res: WorkspaceFileWriteResult = hostedWorkspace
        ? await api.hostedWorkspace.writeFile(
            hostedWorkspace,
            tabPath,
            tabContent,
            activeTab.revision!,
          )
        : remoteAgentId
          ? await api.swarm.writeRemoteFile(
              remoteAgentId,
              tabPath,
              tabContent,
              activeTab.revision!,
            )
          : await api.writeFile(tabPath, tabContent);
      if (openRequests.current.get(tabPath) !== openRequest) return;
      if (res.ok) setTabs((prev) => prev.map((t) => t.path !== tabPath ? t : {
        ...t,
        savedContent: tabContent,
        revision: res.revision ?? t.revision,
      }));
      else setSaveError(res.error ?? "Failed to save");
    } catch (e) {
      if (openRequests.current.get(tabPath) !== openRequest) return;
      setSaveError(
        e instanceof ApiClientError && e.status === 409
          ? "File changed since you opened it. Copy your edits, close this tab, then open the file from Files to reload it."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
    finally { setSaving(false); }
  }, [activeTab, hostedWorkspace, remoteAgentId, saving, readOnly, readOnlyReason]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.defaultPrevented && !e.altKey && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        if (closedTabs.length === 0) return;
        e.preventDefault();
        reopenClosedTab();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closedTabs.length, handleSave, reopenClosedTab]);

  const highlightedHtml = useMemo(() => {
    if (activeContent == null) return "";
    const content = activeContent;
    if (content.length > MAX_HIGHLIGHT_SIZE) return content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    try {
      if (language && hljs.getLanguage(language)) return hljs.highlight(content, { language }).value;
      return hljs.highlightAuto(content).value;
    } catch {
      return content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }, [activeContent, language]);

  const lineCount = activeContent ? activeContent.split("\n").length : 0;

  return {
    tabs, activeTab, activeTabPath, setActiveTabPath,
    openTab, closeTab, reopenClosedTab, canReopenClosedTab: closedTabs.length > 0,
    saving, saveError, dirty, language, readOnly, readOnlyReason,
    handleContentChange, handleSave,
    textareaRef, gutterRef, highlightRef,
    highlightedHtml, lineCount,
  };
}
