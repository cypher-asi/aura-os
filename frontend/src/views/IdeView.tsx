import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ButtonWindow, Spinner, Text, Topbar } from "@cypher-asi/zui";
import { Save, X } from "lucide-react";
import hljs from "highlight.js/lib/common";
import { api } from "../api/client";
import { FileExplorer } from "../components/FileExplorer";
import { Lane } from "../components/Lane";
import { filenameFromPath, langFromPath } from "../ide/lang";
import { windowCommand } from "../lib/windowCommand";
import styles from "./IdeView.module.css";

const MAX_HIGHLIGHT_SIZE = 100_000;

interface TabState {
  path: string;
  content: string | null;
  savedContent: string | null;
  loading: boolean;
  error: string | null;
}

export function IdeView() {
  const [params] = useSearchParams();
  const initialFile = params.get("file") ?? "";
  const rootPath =
    params.get("root") ??
    (initialFile ? initialFile.replace(/[\\/][^\\/]+$/, "") : "");

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
      };
      api
        .readFile(path)
        .then((res) => {
          setTabs((prev2) =>
            prev2.map((t) => {
              if (t.path !== path) return t;
              if (res.ok && res.content != null) {
                return {
                  ...t,
                  content: res.content,
                  savedContent: res.content,
                  loading: false,
                };
              }
              return {
                ...t,
                error: res.error ?? "Failed to read file",
                loading: false,
              };
            }),
          );
        })
        .catch((e) => {
          setTabs((prev2) =>
            prev2.map((t) => {
              if (t.path !== path) return t;
              return { ...t, error: String(e), loading: false };
            }),
          );
        });
      return [...prev, newTab];
    });
    setActiveTabPath(path);
  }, []);

  const closeTab = useCallback(
    (path: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.path === path);
        const newTabs = prev.filter((t) => t.path !== path);
        if (path === activeTabPath) {
          if (newTabs.length === 0) {
            setActiveTabPath(null);
          } else {
            const newIdx = Math.min(idx, newTabs.length - 1);
            setActiveTabPath(newTabs[newIdx].path);
          }
        }
        return newTabs;
      });
    },
    [activeTabPath],
  );

  useEffect(() => {
    if (initialFile) openTab(initialFile);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;
  const dirty =
    activeTab != null &&
    activeTab.content !== null &&
    activeTab.savedContent !== null &&
    activeTab.content !== activeTab.savedContent;
  const language = useMemo(
    () => (activeTab ? langFromPath(activeTab.path) : null),
    [activeTab?.path],
  );

  const handleContentChange = useCallback(
    (newContent: string) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.path !== activeTabPath) return t;
          return { ...t, content: newContent };
        }),
      );
    },
    [activeTabPath],
  );

  const handleSave = useCallback(async () => {
    if (!activeTab || activeTab.content == null || saving) return;
    const tabPath = activeTab.path;
    const tabContent = activeTab.content;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.writeFile(tabPath, tabContent);
      if (res.ok) {
        setTabs((prev) =>
          prev.map((t) => {
            if (t.path !== tabPath) return t;
            return { ...t, savedContent: tabContent };
          }),
        );
      } else {
        setSaveError(res.error ?? "Failed to save");
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [activeTab, saving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = ta.scrollTop;
      highlightRef.current.scrollLeft = ta.scrollLeft;
    }
  }, []);

  const handleTab = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const value = ta.value;
        const newValue =
          value.substring(0, start) + "  " + value.substring(end);
        handleContentChange(newValue);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [handleContentChange],
  );

  const highlightedHtml = useMemo(() => {
    if (!activeTab || activeTab.content == null) return "";
    const content = activeTab.content;
    if (content.length > MAX_HIGHLIGHT_SIZE) {
      return content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(content, { language }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch {
      return content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }, [activeTab?.content, language]);

  const lineCount = activeTab?.content
    ? activeTab.content.split("\n").length
    : 0;

  const handleFileSelect = useCallback(
    (path: string) => {
      openTab(path);
    },
    [openTab],
  );

  return (
    <div className={styles.root}>
      {/* ---- Titlebar ---- */}
      <Topbar
        className="titlebar-drag"
        onDoubleClick={() => windowCommand("maximize")}
        icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
        title={<span className="titlebar-center">AURA IDE</span>}
        actions={
          <div className="titlebar-no-drag" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <ButtonWindow action="minimize" size="sm" onClick={() => windowCommand("minimize")} />
            <ButtonWindow action="maximize" size="sm" onClick={() => windowCommand("maximize")} />
            <ButtonWindow action="close" size="sm" onClick={() => windowCommand("close")} />
          </div>
        }
      />

      {/* ---- Body ---- */}
      <div className={styles.body}>
        {/* Sidebar with file explorer */}
        {rootPath && (
          <Lane
            resizable
            resizePosition="right"
            defaultWidth={220}
            minWidth={120}
            maxWidth={480}
            storageKey="ide-sidebar-width"
            className={styles.sidebar}
          >
            <FileExplorer
              rootPath={rootPath}
              onFileSelect={handleFileSelect}
            />
          </Lane>
        )}

        <div className={styles.editorPane}>
          {/* Tab bar */}
          <div className={styles.tabBar}>
            <div className={styles.tabList}>
              {tabs.map((tab) => {
                const tabDirty =
                  tab.content !== null &&
                  tab.savedContent !== null &&
                  tab.content !== tab.savedContent;
                const tabFilename = filenameFromPath(tab.path);
                return (
                  <button
                    key={tab.path}
                    className={`${styles.tab} ${tab.path === activeTabPath ? styles.active : ""} ${tabDirty ? styles.dirty : ""}`}
                    onClick={() => setActiveTabPath(tab.path)}
                    title={tab.path}
                  >
                    <span className={styles.tabDot} />
                    {tabFilename}
                    <span
                      className={styles.tabClose}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.path);
                      }}
                    >
                      <X size={12} className={styles.tabCloseIcon} />
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              className={styles.saveButton}
              disabled={!dirty || saving}
              onClick={handleSave}
              title="Save (Ctrl+S)"
            >
              <Save size={14} />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {/* Editor content */}
          {activeTab?.loading && (
            <div className={styles.loading}>
              <Spinner size="md" />
            </div>
          )}

          {activeTab?.error && (
            <div className={styles.error}>
              <Text variant="primary">{activeTab.error}</Text>
            </div>
          )}

          {!activeTab && tabs.length === 0 && (
            <div className={styles.loading}>
              <Text variant="secondary">Open a file from the sidebar</Text>
            </div>
          )}

          {activeTab &&
            !activeTab.loading &&
            !activeTab.error &&
            activeTab.content != null && (
              <div className={styles.editorBody}>
                <div ref={gutterRef} className={styles.gutter}>
                  {Array.from({ length: lineCount }, (_, i) => (
                    <span key={i} className={styles.gutterLine}>
                      {i + 1}
                    </span>
                  ))}
                </div>
                <div className={styles.editorContainer}>
                  <pre
                    ref={highlightRef}
                    className={styles.codeHighlight}
                    aria-hidden
                  >
                    <code
                      className={
                        language ? `hljs language-${language}` : "hljs"
                      }
                      dangerouslySetInnerHTML={{
                        __html: highlightedHtml + "\n",
                      }}
                    />
                  </pre>
                  <textarea
                    ref={textareaRef}
                    className={styles.codeArea}
                    value={activeTab.content}
                    onChange={(e) => handleContentChange(e.target.value)}
                    onScroll={handleScroll}
                    onKeyDown={handleTab}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                </div>
              </div>
            )}
        </div>
      </div>

      {/* ---- Status bar ---- */}
      <div className={styles.statusBar}>
        <span className={styles.statusItem}>
          {language ?? "plain text"}
        </span>
        {lineCount > 0 && (
          <span className={styles.statusItem}>{lineCount} lines</span>
        )}
        {saveError && (
          <span
            className={styles.statusItem}
            style={{ color: "var(--color-danger)" }}
          >
            {saveError}
          </span>
        )}
        {saving && <span className={styles.statusItem}>Saving…</span>}
        <span style={{ flex: 1 }} />
        {activeTab && (
          <span className={styles.statusItem}>{activeTab.path}</span>
        )}
      </div>
    </div>
  );
}
