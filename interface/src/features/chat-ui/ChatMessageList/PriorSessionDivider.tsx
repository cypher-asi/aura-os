interface PriorSessionDividerProps {
  label: string;
  startedAt: string;
}

function formatStartedAt(startedAt: string): string {
  if (!startedAt) return "";
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Labeled separator rendered between session blocks when prior sessions
 * have been loaded above the current chat. Shows the session title and
 * its start date so the user can tell loaded history apart from the
 * conversation they opened.
 */
export function PriorSessionDivider({ label, startedAt }: PriorSessionDividerProps) {
  const date = formatStartedAt(startedAt);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 0",
        width: "100%",
      }}
    >
      <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
      <span
        style={{
          color: "var(--color-text-muted)",
          fontSize: 12,
          whiteSpace: "nowrap",
          maxWidth: "60%",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
        {date ? ` · ${date}` : ""}
      </span>
      <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
    </div>
  );
}
