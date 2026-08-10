import { useMemo, useState } from "react";
import { Check, Code2, MessageSquarePlus, X } from "lucide-react";
import type { DesignElement } from "../../../../shared/api/browser";
import {
  buildDesignPrompt,
  dispatchDesignPrompt,
} from "../../../../shared/lib/design-context";
import styles from "./BrowserDesignInspector.module.css";

export interface BrowserDesignInspectorProps {
  element: DesignElement | null;
  projectId?: string;
  onClear: () => void;
}

function sourceLabel(element: DesignElement): string | null {
  const source = element.source;
  if (!source?.file) return null;
  const fileName = source.file.split("/").filter(Boolean).pop() ?? source.file;
  const position = source.line
    ? `:${source.line}${source.column ? `:${source.column}` : ""}`
    : "";
  return `${source.component ? `${source.component} · ` : ""}${fileName}${position}`;
}

export function BrowserDesignInspector({
  element,
  projectId,
  onClear,
}: BrowserDesignInspectorProps) {
  if (!element) {
    return (
      <div className={styles.hint} data-testid="design-mode-hint">
        <span className={styles.cursorDot} aria-hidden="true" />
        Hover to inspect. Click an element to design it.
      </div>
    );
  }

  return (
    <SelectedDesignInspector
      key={element.selector}
      element={element}
      projectId={projectId}
      onClear={onClear}
    />
  );
}

function SelectedDesignInspector({
  element,
  projectId,
  onClear,
}: {
  element: DesignElement;
  projectId?: string;
  onClear: () => void;
}) {
  const [request, setRequest] = useState("");
  const [handoff, setHandoff] = useState<"idle" | "added" | "missing">("idle");
  const source = useMemo(() => sourceLabel(element), [element]);

  const handleAddToChat = () => {
    if (!request.trim()) return;
    const handled = dispatchDesignPrompt({
      projectId,
      prompt: buildDesignPrompt(request, element),
    });
    setHandoff(handled ? "added" : "missing");
  };

  return (
    <section
      className={styles.card}
      aria-label="Selected element"
      data-testid="design-inspector"
    >
      <header className={styles.header}>
        <div className={styles.elementTitle}>
          <Code2 size={13} aria-hidden="true" />
          <strong>{`<${element.tag_name}>`}</strong>
          <span>{element.selector}</span>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClear}
          aria-label="Clear selection"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </header>

      {source ? <div className={styles.source}>{source}</div> : null}

      <div className={styles.metrics}>
        <span>{`${Math.round(element.bounds.width)} × ${Math.round(element.bounds.height)}`}</span>
        <span>{element.styles.display}</span>
        <span>{element.styles.font_size}</span>
      </div>

      <label className={styles.promptLabel} htmlFor="design-change-request">
        What should change?
      </label>
      <textarea
        id="design-change-request"
        className={styles.prompt}
        value={request}
        onChange={(event) => {
          setRequest(event.target.value);
          setHandoff("idle");
        }}
        placeholder="Make this card feel lighter and increase its spacing…"
        rows={3}
      />
      <button
        type="button"
        className={styles.addButton}
        disabled={!request.trim()}
        onClick={handleAddToChat}
      >
        {handoff === "added" ? (
          <Check size={13} aria-hidden="true" />
        ) : (
          <MessageSquarePlus size={13} aria-hidden="true" />
        )}
        {handoff === "added"
          ? "Added to chat"
          : handoff === "missing"
            ? "Open an agent chat first"
            : "Add to chat"}
      </button>
    </section>
  );
}
