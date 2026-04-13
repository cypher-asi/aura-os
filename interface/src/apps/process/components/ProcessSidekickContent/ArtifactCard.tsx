import type { ProcessArtifact } from "../../../../types";

function formatArtifactSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

export function ArtifactCard({ artifact }: { artifact: ProcessArtifact }) {
  const displayName = artifact.name?.trim() || artifact.file_path?.split("/").pop() || "Untitled artifact";

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", fontSize: 12, overflow: "hidden" }}>
      <ArtifactCardHeader
        displayName={displayName}
        artifactType={artifact.artifact_type}
        sizeBytes={artifact.size_bytes}
        filePath={artifact.file_path}
        createdAt={artifact.created_at}
      />
    </div>
  );
}

function ArtifactCardHeader({
  displayName, artifactType, sizeBytes, filePath, createdAt,
}: {
  displayName: string;
  artifactType: string;
  sizeBytes: number;
  filePath: string;
  createdAt: string;
}) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 2, padding: "6px 8px",
        width: "100%", textAlign: "left", color: "var(--color-text)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: "rgba(107,114,128,0.35)",
        }} />
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayName}
        </span>
        <span style={{
          fontSize: 10, padding: "1px 6px", borderRadius: 0,
          background: "rgba(107,114,128,0.1)",
          color: "var(--color-text-muted)",
          fontWeight: 600, flexShrink: 0,
        }}>
          {artifactType}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
          {formatArtifactSize(sizeBytes)}
        </span>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
          {new Date(createdAt).toLocaleString()}
        </span>
        {filePath && (
          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {filePath}
          </span>
        )}
      </div>
    </div>
  );
}
