import { useCallback, type RefObject } from "react";
import { Spinner, Text } from "@cypher-asi/zui";
import type { TabState } from "./useIdeViewTabs";
import styles from "./IdeView.module.css";

interface Props {
  activeTab: TabState | null;
  tabCount: number;
  language: string | null;
  lineCount: number;
  highlightedHtml: string;
  onContentChange: (content: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  gutterRef: RefObject<HTMLDivElement | null>;
  highlightRef: RefObject<HTMLPreElement | null>;
}

export function EditorBody({
  activeTab, tabCount, language, lineCount, highlightedHtml,
  onContentChange, textareaRef, gutterRef, highlightRef,
}: Props) {
  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = ta.scrollTop;
      highlightRef.current.scrollLeft = ta.scrollLeft;
    }
  }, [textareaRef, gutterRef, highlightRef]);

  const handleTab = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = ta.value.substring(0, start) + "  " + ta.value.substring(end);
      onContentChange(newValue);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
    }
  }, [onContentChange]);

  if (activeTab?.loading) {
    return <div className={styles.loading}><Spinner size="md" /></div>;
  }

  if (activeTab?.error) {
    return <div className={styles.error}><Text variant="primary">{activeTab.error}</Text></div>;
  }

  if (!activeTab && tabCount === 0) {
    return <div className={styles.loading}><Text variant="secondary">Open a file from the sidebar</Text></div>;
  }

  if (!activeTab || activeTab.loading || activeTab.error || activeTab.content == null) return null;

  return (
    <div className={styles.editorBody}>
      <div ref={gutterRef} className={styles.gutter}>
        {Array.from({ length: lineCount }, (_, i) => (
          <span key={i} className={styles.gutterLine}>{i + 1}</span>
        ))}
      </div>
      <div className={styles.editorContainer}>
        <pre ref={highlightRef} className={styles.codeHighlight} aria-hidden>
          <code className={language ? `hljs language-${language}` : "hljs"} dangerouslySetInnerHTML={{ __html: highlightedHtml + "\n" }} />
        </pre>
        <textarea
          ref={textareaRef}
          className={styles.codeArea}
          value={activeTab.content}
          onChange={(e) => onContentChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleTab}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  );
}
