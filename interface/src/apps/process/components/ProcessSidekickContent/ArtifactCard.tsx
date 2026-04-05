import { useCallback, useState } from "react";
import { processApi } from "../../../../api/process";
import { desktopApi } from "../../../../api/desktop";
import type { ProcessArtifact } from "../../../../types";

export function ArtifactCard({ artifact }: { artifact: ProcessArtifact }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const displayName = artifact.name?.trim() || artifact.file_path?.split("/").pop() || "Untitled artifact";

  const loadAndExpand = useCallback(async () => {
    if (expanded) { setExpanded(false); return; }
    if (content !== null) { setExpanded(true); return; }
    setLoading(true);
    try {
      const text = await processApi.getArtifactContent(artifact.artifact_id);
      setContent(text);
      setExpanded(true);
    } catch (err) {
      console.error("Failed to load artifact content:", err);
    } finally {
      setLoading(false);
    }
  }, [artifact.artifact_id, content, expanded]);

  const handleShowInFolder = useCallback(async () => {
    try {
      const { path } = await processApi.getArtifactPath(artifact.artifact_id);
      const parentDir = path.replace(/[\\/][^\\/]*$/, "");
      await desktopApi.openPath(parentDir);
    } catch (err) {
      console.error("Failed to show artifact in folder:", err);
    }
  }, [artifact.artifact_id]);

  const btnStyle: React.CSSProperties = {
    background: "transparent", border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)", padding: "4px 8px", cursor: "pointer",
    fontSize: 11, color: "var(--color-text)",
  };

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", fontSize: 12, overflow: "hidden" }}>
      <ArtifactCardHeader
        displayName={displayName}
        artifactType={artifact.artifact_type}
        sizeBytes={artifact.size_bytes}
        loading={loading}
        expanded={expanded}
        onClick={loadAndExpand}
      />
      {expanded && content !== null && (
        <ArtifactCardBody
          content={content}
          onShowInFolder={handleShowInFolder}
          btnStyle={btnStyle}
        />
      )}
    </div>
  );
}

function ArtifactCardHeader({
  displayName, artifactType, sizeBytes, loading, expanded, onClick,
}: {
  displayName: string;
  artifactType: string;
  sizeBytes: number;
  loading: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 8px", width: "100%", background: "transparent",
        border: "none", cursor: "pointer", color: "var(--color-text)", textAlign: "left",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{displayName}</div>
        <div style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
          {artifactType} &middot; {(sizeBytes / 1024).toFixed(1)} KB
        </div>
      </div>
      <span style={{ fontSize: 10, color: "var(--color-text-muted)", flexShrink: 0 }}>
        {loading ? "\u2026" : expanded ? "\u25B2" : "\u25BC"}
      </span>
    </button>
  );
}

function ArtifactCardBody({
  content, onShowInFolder, btnStyle,
}: {
  content: string;
  onShowInFolder: () => void;
  btnStyle: React.CSSProperties;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--color-border)" }}>
      <div style={{
        padding: 8, maxHeight: 300, overflow: "auto",
        whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)",
        fontSize: 11, lineHeight: 1.5, background: "var(--color-bg-input)",
      }}>
        {content}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px", borderTop: "1px solid var(--color-border)" }}>
        <button type="button" onClick={onShowInFolder} style={btnStyle}>
          Show in Folder
        </button>
      </div>
    </div>
  );
}
