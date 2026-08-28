import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import hljs from "highlight.js/lib/common";
import { api } from "../../api/client";
import { langFromPath } from "../../ide/lang";
import type { HostedWorkspaceTarget } from "../../shared/api/hosted-workspace";

const MAX_HIGHLIGHT_SIZE = 100_000;

export interface TabState {
  path: string;
  content: string | null;
  savedContent: string | null;
  loading: boolean;
  error: string | null;
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
  const readOnly = Boolean(remoteAgentId || hostedWorkspace);
  const readOnlyReason = hostedWorkspace
    ? "Hosted workspace preview is read-only. Ask the agent to change files."
    : remoteAgentId
      ? "Remote IDE preview is read-only. Use Aura Desktop or a remote agent task to change files."
      : null;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const openTab = useCallback((path: string) => {
    setTabs((prev) => {
      if (prev.find((t) => t.path === path)) return prev;
      const newTab: TabState = { path, content: null, savedContent: null, loading: true, error: null };
      const readPromise = hostedWorkspace
        ? api.hostedWorkspace.readFile(hostedWorkspace, path)
        : remoteAgentId
          ? api.swarm.readRemoteFile(remoteAgentId, path)
          : api.readFile(path);
      readPromise
        .then((res) => {
          setTabs((prev2) => prev2.map((t) => {
            if (t.path !== path) return t;
            return res.ok && res.content != null
              ? { ...t, content: res.content, savedContent: res.content, loading: false }
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
  const dirty = activeTab != null && activeTab.content !== null && activeTab.savedContent !== null && activeTab.content !== activeTab.savedContent;
  const language = useMemo(() => (activeTab ? langFromPath(activeTab.path) ?? null : null), [activeTab?.path]);

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
    setSaving(true); setSaveError(null);
    try {
      const res = await api.writeFile(tabPath, tabContent);
      if (res.ok) setTabs((prev) => prev.map((t) => t.path !== tabPath ? t : { ...t, savedContent: tabContent }));
      else setSaveError(res.error ?? "Failed to save");
    } catch (e) { setSaveError(String(e)); }
    finally { setSaving(false); }
  }, [activeTab, saving, readOnly, readOnlyReason]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

  const highlightedHtml = useMemo(() => {
    if (!activeTab || activeTab.content == null) return "";
    const content = activeTab.content;
    if (content.length > MAX_HIGHLIGHT_SIZE) return content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    try {
      if (language && hljs.getLanguage(language)) return hljs.highlight(content, { language }).value;
      return hljs.highlightAuto(content).value;
    } catch {
      return content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }, [activeTab?.content, language]);

  const lineCount = activeTab?.content ? activeTab.content.split("\n").length : 0;

  return {
    tabs, activeTab, activeTabPath, setActiveTabPath,
    openTab, closeTab,
    saving, saveError, dirty, language, readOnly, readOnlyReason,
    handleContentChange, handleSave,
    textareaRef, gutterRef, highlightRef,
    highlightedHtml, lineCount,
  };
}
