import type { AnnotatedSession } from "./session-row-utils";

export type SessionSnoozePresetId = "hour" | "tomorrow";

export interface SessionSnoozePreset {
  id: SessionSnoozePresetId;
  snoozedUntil: string;
}

export function resolveSessionSnoozePresets(now: Date): SessionSnoozePreset[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    {
      id: "hour",
      snoozedUntil: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    },
    { id: "tomorrow", snoozedUntil: tomorrow.toISOString() },
  ];
}

export function isSessionSnoozed(
  session: Pick<AnnotatedSession, "snoozed_until">,
  nowMs: number,
): boolean {
  if (!session.snoozed_until) return false;
  const wakeMs = Date.parse(session.snoozed_until);
  return Number.isFinite(wakeMs) && wakeMs > nowMs;
}

export function formatSessionWakeLabel(snoozedUntil: string): string {
  const wakeAt = new Date(snoozedUntil);
  if (Number.isNaN(wakeAt.getTime())) return "Wake time unavailable";
  return `Wakes ${wakeAt.toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
