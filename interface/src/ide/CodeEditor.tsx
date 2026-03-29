import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Modal, Spinner, Text, Button } from "@cypher-asi/zui";
import { Save } from "lucide-react";
import hljs from "highlight.js/lib/common";
import { api } from "../api/client";
import { filenameFromPath, langFromPath } from "./lang";
import styles from "./CodeEditor.module.css";

const MAX_HIGHLIGHT_SIZE = 100_000;

export interface CodeEditorProps {
  filePath: string;
  onClose: () => void;
}

export function CodeEditor({ filePath, onClose }: CodeEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const dirty = content !== null && savedContent !== null && content !== savedContent;

  const language = useMemo(() => langFromPath(filePath), [filePath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    setSavedContent(null);
    setSaveError(null);
    setLastSaved(null);

    api
      .readFile(filePath)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.content != null) {
          setContent(res.content);
          setSavedContent(res.content);
        } else {
          setError(res.error ?? "Failed to read file");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const handleSave = useCallback(async () => {
    if (content == null || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.writeFile(filePath, content);
      if (res.ok) {
        setSavedContent(content);
        setLastSaved(new Date());
      } else {
        setSaveError(res.error ?? "Failed to save");
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [filePath, content, saving]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
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
        const newValue = value.substring(0, start) + "  " + value.substring(end);
        setContent(newValue);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [],
  );

  const highlightedHtml = useMemo(() => {
    if (content == null) return "";
    if (content.length > MAX_HIGHLIGHT_SIZE) {
      const escaped = content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return escaped;
    }
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(content, { language }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch {
      const escaped = content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return escaped;
    }
  }, [content, language]);

  const lineCount = content ? content.split("\n").length : 0;
  const filename = filenameFromPath(filePath);
  const titleDisplay = dirty ? `● ${filename}` : filename;

  const displayLang = language ?? "plain text";

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={titleDisplay}
      subtitle={filePath}
      size="xl"
      fullHeight
      noPadding
      headerActions={
        <div className={styles.headerActions}>
          <span className={styles.langBadge}>{displayLang}</span>
          {saveError && (
            <Text variant="primary" size="sm" className={styles.saveError}>
              {saveError}
            </Text>
          )}
          {lastSaved && !saveError && (
            <Text variant="muted" size="sm">
              Saved
            </Text>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={<Save size={14} />}
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      }
    >
      {loading && (
        <div className={styles.loading}>
          <Spinner size="md" />
        </div>
      )}

      {error && (
        <div className={styles.error}>
          <Text variant="primary">{error}</Text>
        </div>
      )}

      {!loading && !error && content != null && (
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
                className={language ? `hljs language-${language}` : "hljs"}
                dangerouslySetInnerHTML={{ __html: highlightedHtml + "\n" }}
              />
            </pre>
            <textarea
              ref={textareaRef}
              className={styles.codeArea}
              value={content}
              onChange={(e) => setContent(e.target.value)}
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
    </Modal>
  );
}
