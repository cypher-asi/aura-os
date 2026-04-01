import { Button, Text } from "@cypher-asi/zui";
import styles from "./ImportFilesSection.module.css";

export function ImportFilesSection({
  importFolderInputRef,
  importFilesInputRef,
  onImportSelection,
  importSummary,
  loading,
}: {
  importFolderInputRef: React.RefObject<HTMLInputElement | null>;
  importFilesInputRef: React.RefObject<HTMLInputElement | null>;
  onImportSelection: (files: FileList | null) => void;
  importSummary: { count: number; sizeLabel: string; samplePaths: string[] };
  loading: boolean;
}) {
  return (
    <div className={styles.container}>
      <input
        ref={importFolderInputRef}
        type="file"
        multiple
        onChange={(event) => onImportSelection(event.target.files)}
        className={styles.hidden}
      />
      <input
        ref={importFilesInputRef}
        type="file"
        multiple
        onChange={(event) => onImportSelection(event.target.files)}
        className={styles.hidden}
      />
      <div className={styles.buttonRow}>
        <Button variant="secondary" onClick={() => importFolderInputRef.current?.click()} disabled={loading}>
          Open folder
        </Button>
        <Button variant="ghost" onClick={() => importFilesInputRef.current?.click()} disabled={loading}>
          Choose files
        </Button>
      </div>
      {importSummary.count === 0 && (
        <Text size="sm" className={styles.warningText}>
          Choose a folder or files to enable project creation.
        </Text>
      )}
      <Text variant="muted" size="sm">
        Aura stages the selected local files into an agent workspace so you can keep working from the browser.
      </Text>
      {importSummary.count > 0 && (
        <div className={styles.summaryCard}>
          <Text size="sm" className={styles.boldLabel}>
            {importSummary.count} file{importSummary.count === 1 ? "" : "s"} selected
          </Text>
          <Text variant="muted" size="sm">
            {importSummary.sizeLabel}
          </Text>
          {importSummary.samplePaths.map((path) => (
            <Text key={path} variant="muted" size="xs" className={styles.breakAllText}>
              {path}
            </Text>
          ))}
        </div>
      )}
    </div>
  );
}
