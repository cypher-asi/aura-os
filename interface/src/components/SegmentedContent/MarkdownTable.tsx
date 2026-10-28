import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { copyToClipboard } from "../../shared/utils/clipboard";
import styles from "./MarkdownTable.module.css";

import { tableToCsv } from "./table-to-csv";

export function MarkdownTable({ markdown, children, ...props }: ComponentProps<"table"> & { markdown: string }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (format: "CSV" | "Markdown") => {
    const table = tableRef.current;
    if (!table) return;
    setFailed(false);
    try {
      await copyToClipboard(format === "CSV" ? tableToCsv(table) : markdown);
      setCopied(format);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
      setFailed(true);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.scroll} role="region" aria-label="Scrollable table" tabIndex={0}>
        <table {...props} ref={tableRef}>{children}</table>
      </div>
      <div className={styles.toolbar} data-markdown-copy-ignore>
        {(["CSV", "Markdown"] as const).map((format) => {
          const Icon = copied === format ? Check : Copy;
          return <button type="button" key={format} onClick={() => void copy(format)}
            aria-label={`Copy table as ${format}`}>
            <Icon size={12} aria-hidden="true" />
            {copied === format ? "Copied" : `Copy ${format}`}
          </button>;
        })}
        <span className={styles.feedback} role={failed ? "alert" : "status"}>
          {failed ? "Couldn't copy table. Try again." : copied ? `${copied} copied` : ""}
        </span>
      </div>
    </div>
  );
}
