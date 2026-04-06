import { useCallback, useState, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { processApi } from "../../../../api/process";
import { desktopApi } from "../../../../api/desktop";
import type { ProcessArtifact } from "../../../../types";

function formatArtifactSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

export function ArtifactCard({ artifact }: { artifact: ProcessArtifact }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const displayName = artifact.name?.trim() || artifact.file_path?.split("/").pop() || "Untitled artifact";

  const loadAndExpand = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (content !== null) {
      setExpanded(true);
      return;
    }
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

  const btnStyle: CSSProperties = {
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
        filePath={artifact.file_path}
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
  displayName, artifactType, sizeBytes, filePath, loading, expanded, onClick,
}: {
  displayName: string;
  artifactType: string;
  sizeBytes: number;
  filePath: string;
  loading: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", gap: 2, padding: "6px 8px",
        background: "transparent", border: "none", cursor: "pointer",
        width: "100%", textAlign: "left", color: "var(--color-text)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
        <span style={{
          display: "flex", alignItems: "center", flexShrink: 0,
          transition: "transform 0.2s ease",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          color: "var(--color-text-muted)",
        }}>
          <ChevronRight size={12} />
        </span>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: "rgba(107,114,128,0.35)",
        }} />
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayName}
        </span>
        <span style={{
          fontSize: 10, padding: "1px 6px", borderRadius: 0,
          background: loading ? "rgba(59,130,246,0.15)" : "rgba(107,114,128,0.1)",
          color: loading ? "#3b82f6" : "var(--color-text-muted)",
          fontWeight: 600, flexShrink: 0,
          fontFamily: loading ? "var(--font-mono)" : undefined,
        }}>
          {loading ? "Loading" : artifactType}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 18, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
          {formatArtifactSize(sizeBytes)}
        </span>
        {filePath && (
          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {filePath}
          </span>
        )}
      </div>
    </button>
  );
}

function ArtifactCardBody({
  content, onShowInFolder, btnStyle,
}: {
  content: string;
  onShowInFolder: () => void;
  btnStyle: CSSProperties;
}) {
  return (
    <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div>
        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 2 }}>Preview</div>
        <div style={{
          background: "var(--color-bg-input)", padding: 6, borderRadius: "var(--radius-sm)",
          whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 11,
          maxHeight: 300, overflow: "auto", lineHeight: 1.5,
        }}>
          {content}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={onShowInFolder} style={btnStyle}>
          Show in Folder
        </button>
      </div>
    </div>
  );
}
