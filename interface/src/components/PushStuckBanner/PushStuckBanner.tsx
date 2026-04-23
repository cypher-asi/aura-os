import { AlertTriangle, X } from "lucide-react";
import { Button, Text } from "@cypher-asi/zui";
import { useEventStore, usePushStuck } from "../../stores/event-store/index";

/**
 * Persistent project-header advisory rendered when the dev loop has emitted
 * a `project_push_stuck` domain event (i.e. the remote has rejected at least
 * `CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD` back-to-back pushes). The
 * backend keeps dispatching task work regardless; this banner tells the
 * user their commits are piling up locally so they can free space / swap
 * remotes without having to infer it from per-task "Push deferred" rows.
 *
 * Dismissal is session-scoped (not persisted) so a reload or a browser
 * restart will re-surface the advisory if the streak is still active.
 * A successful `git_pushed` event on the same project clears the state
 * entirely via the engine event handler.
 */
export function PushStuckBanner({ projectId }: { projectId: string | undefined }) {
  const info = usePushStuck(projectId);
  const dismissPushStuck = useEventStore((s) => s.dismissPushStuck);
  if (!projectId) return null;
  if (!info || info.dismissed) return null;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        background:
          "color-mix(in srgb, var(--color-warning, #d97706) 12%, var(--color-bg-surface))",
        borderBottom: "1px solid var(--color-border)",
        color: "var(--color-text)",
        fontSize: 12,
      }}
      data-testid="push-stuck-banner"
    >
      <AlertTriangle size={14} aria-hidden />
      <Text size="xs" as="span" style={{ flex: 1 }}>
        Push blocked by remote. Tasks will keep running locally until you
        free space or switch remotes.
      </Text>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<X size={12} />}
        title="Dismiss"
        aria-label="Dismiss push-stuck banner"
        onClick={() => dismissPushStuck(projectId)}
      />
    </div>
  );
}