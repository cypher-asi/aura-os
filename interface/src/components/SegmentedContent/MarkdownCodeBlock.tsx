import { useId, useState, type ReactNode } from "react";
import { WrapText } from "lucide-react";
import styles from "./MarkdownCodeBlock.module.css";

export function MarkdownCodeBlock({ children, className }: {
  children?: ReactNode;
  className?: string;
}) {
  const [wrapped, setWrapped] = useState(false);
  const codeId = useId();
  return (
    <div className={styles.codeBlock}>
      <div className={styles.toolbar} data-markdown-copy-ignore>
        <button
          type="button"
          className={styles.wrapButton}
          aria-label="Wrap code"
          aria-pressed={wrapped}
          aria-controls={codeId}
          title={wrapped ? "Use horizontal scrolling" : "Wrap long lines to fit"}
          onClick={() => setWrapped((value) => !value)}
        >
          <WrapText size={14} aria-hidden="true" />
          {wrapped ? "Unwrap" : "Wrap"}
        </button>
      </div>
      <pre id={codeId} className={`${styles.pre}${className ? ` ${className}` : ""}`}
        data-wrapped={wrapped} tabIndex={0} aria-label="Code block">
        {children}
      </pre>
    </div>
  );
}
