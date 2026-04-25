/**
 * Narrow the JSON `content` field of an `AuraEvent` to a generic
 * `Record<string, unknown>` for ad-hoc property access by call sites that
 * already know the event type they're handling.
 *
 * Centralising this cast keeps the per-call narrowing pattern
 * `event.content as unknown as Record<string, unknown>` from drifting
 * across the codebase, and gives us a single seam for stricter typing
 * (e.g. swapping in a real `JsonValue` schema later) without touching
 * every consumer.
 */
export function parseEventContent(event: { content?: unknown }): Record<string, unknown> {
  return (event?.content ?? {}) as Record<string, unknown>;
}
