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

export interface TabState {
  path: string;
  content: string | null;
  savedContent: string | null;
  loading: boolean;
  error: string | null;
  revision: string | null;
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const openTab = useCallback((path: string) => {
    setTabs((prev) => {
      if (prev.find((t) => t.path === path)) return prev;
      const newTab: TabState = {
        path,
        content: null,
        savedContent: null,
        loading: true,
        error: null,
        revision: null,
      };
      const readPromise: Promise<WorkspaceFileReadResult> = hostedWorkspace
        ? api.hostedWorkspace.readFile(hostedWorkspace, path)
        : remoteAgentId
          ? api.swarm.readRemoteFile(remoteAgentId, path)
          : api.readFile(path);
      readPromise
        .then((res) => {
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
          setTabs((prev2) => prev2.map((t) => t.path !== path ? t : { ...t, error: String(e), loading: false }));
        });
      return [...prev, newTab];
    });
    setActiveTabPath(path);
  }, [hostedWorkspace, remoteAgentId]);

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      const newTabs = prev.filter((t) => t.path !== path);
      if (path === activeTabPath) {
        setActiveTabPath(newTabs.length === 0 ? null : newTabs[Math.min(idx, newTabs.length - 1)].path);
      }
      return newTabs;
    });
  }, [activeTabPath]);

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
      if (res.ok) setTabs((prev) => prev.map((t) => t.path !== tabPath ? t : {
        ...t,
        savedContent: tabContent,
        revision: res.revision ?? t.revision,
      }));
      else setSaveError(res.error ?? "Failed to save");
    } catch (e) {
      setSaveError(
        e instanceof ApiClientError && e.status === 409
          ? "File changed since you opened it. Close and reopen it before saving."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
    finally { setSaving(false); }
  }, [activeTab, hostedWorkspace, remoteAgentId, saving, readOnly, readOnlyReason]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

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
    openTab, closeTab,
    saving, saveError, dirty, language, readOnly, readOnlyReason,
    handleContentChange, handleSave,
    textareaRef, gutterRef, highlightRef,
    highlightedHtml, lineCount,
  };
}
