import { useMemo, useState, type ReactNode } from "react";
import { parseDelimitedPreview } from "./delimited-preview";
import styles from "./DelimitedFilePreview.module.css";

export function DelimitedFilePreview({ content, delimiter, children }: {
  content: string;
  delimiter: "," | "\t";
  children: ReactNode;
}) {
  const parsed = useMemo(() => parseDelimitedPreview(content, delimiter), [content, delimiter]);
  const available = parsed.rows.length > 0 && !parsed.malformed;
  const [source, setSource] = useState(false);
  const showTable = available && !source;
  const columns = Math.max(0, ...parsed.rows.map((row) => row.length));

  return <div className={styles.root}>
    <div className={styles.controls} role="group" aria-label="File preview format">
      <button type="button" aria-pressed={showTable} disabled={!available} onClick={() => setSource(false)}>Table</button>
      <button type="button" aria-pressed={!showTable} onClick={() => setSource(true)}>Source</button>
    </div>
    {!available ? <p role="status" className={styles.notice}>
      {parsed.malformed ? "This file has inconsistent quoting. Showing the original source." : "No complete records to preview. Showing the original source."}
    </p> : null}
    {showTable ? <>
      <p className={styles.notice} role="status">
        {parsed.rows.length} rows shown. First row shown as headers.
        {parsed.truncated ? " Preview limited to 100 rows, 30 columns, 1,000 characters per cell, and 262,144 characters of input. Use Source for the original text." : ""}
      </p>
      <div className={styles.scroll} role="region" aria-label="Scrollable file table" tabIndex={0}>
        <table>
          <caption>{delimiter === "," ? "CSV" : "TSV"} file preview</caption>
          <thead><tr>{Array.from({ length: columns }, (_, index) => <th scope="col" key={index}>{parsed.rows[0][index] ?? ""}</th>)}</tr></thead>
          <tbody>{parsed.rows.slice(1).map((row, index) => <tr key={index}>
            {Array.from({ length: columns }, (_, column) => <td key={column}>{row[column] ?? ""}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </> : children}
  </div>;
}
