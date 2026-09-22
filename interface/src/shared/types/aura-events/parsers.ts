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
 *
 * Phase 4 wire-shape contract (server commit `83752884b`):
 *   `user_message` and `assistant_message_end` events carry
 *   `{ session_id, project_id, project_agent_id, agent_id }`
 *   at the top level — the legacy `agent_instance_id` field is
 *   GONE for those two types. Other event types (e.g.
 *   `session_summary_updated`, `assistant_turn_progress`) still
 *   send `agent_instance_id`, so we fall back to that field
 *   when `project_agent_id` is missing.
 * ------------------------------------------------------------------ */

export function parseAuraEvent(
  type: string,
  data: unknown,
  context: {
    session_id?: string;
    user_id?: string;
    agent_id?: string;
    project_agent_id?: string;
    project_id?: string;
    org_id?: string;
    sender?: Sender;
  },
): AuraEvent {
  const eventType = type as EventType;
  const d = (data ?? {}) as Record<string, unknown>;

  // Prefer the explicit Phase 4 field; fall back to the legacy
  // `agent_instance_id` only for event types that have not yet
  // migrated to the new wire shape.
  const rawProjectAgentId =
    (d.project_agent_id as string | undefined) ??
    (d.agent_instance_id as string | undefined);

  return {
    event_id: crypto.randomUUID(),
    session_id: context.session_id ?? (d.session_id as string) ?? "",
    user_id: context.user_id ?? (d.user_id as string) ?? "",
    agent_id: context.agent_id ?? (d.agent_id as string) ?? "",
    project_agent_id: context.project_agent_id ?? rawProjectAgentId ?? null,
    sender: context.sender ?? (eventType === EventType.UserMessage ? "user" : "agent"),
    project_id: context.project_id ?? (d.project_id as string) ?? "",
    org_id: context.org_id ?? "",
    type: eventType,
    content: d,
    created_at: new Date().toISOString(),
  } as AuraEvent;
}
