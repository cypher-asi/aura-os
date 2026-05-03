import type { Sender } from "./payloads";
import { EventType, type AuraEvent } from "./event-types";

export type AuraEventOfType<T extends EventType> =
  Extract<AuraEvent, { type: T }>;

export type AuraEventContent<T extends EventType> =
  AuraEventOfType<T>["content"];

export function isValidEventType(value: string): value is EventType {
  return Object.values(EventType).includes(value as EventType);
}

/* ── parseAuraEvent — bridge function ─────────────────────────────
 * Used by both SSE and WS consumers to wrap current transport
 * payloads into the canonical AuraEvent shape.
 *
 * When the backend starts emitting full session_events rows this
 * function becomes a passthrough.
 * ------------------------------------------------------------------ */

export function parseAuraEvent(
  type: string,
  data: unknown,
  context: {
    session_id?: string;
    user_id?: string;
    agent_id?: string;
    project_id?: string;
    org_id?: string;
    sender?: Sender;
  },
): AuraEvent {
  const eventType = type as EventType;
  const d = (data ?? {}) as Record<string, unknown>;

  return {
    event_id: crypto.randomUUID(),
    session_id: context.session_id ?? (d.session_id as string) ?? "",
    user_id: context.user_id ?? "",
    agent_id: context.agent_id ?? (d.agent_instance_id as string) ?? "",
    sender: context.sender ?? (eventType === EventType.UserMessage ? "user" : "agent"),
    project_id: context.project_id ?? (d.project_id as string) ?? "",
    org_id: context.org_id ?? "",
    type: eventType,
    content: d,
    created_at: new Date().toISOString(),
  } as AuraEvent;
}
