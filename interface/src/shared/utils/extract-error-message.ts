/**
 * Pull a short, human-readable message out of a raw error string.
 *
 * The server sometimes hands us JSON error bodies (`{"message": "..."}`)
 * or prefixed diagnostics (`ApiError: ...`). For the failure banner on
 * task cards we want only the inner message, not the wrapping.
 */
export function extractErrorMessage(raw: string): string {
  const jsonMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (jsonMatch) return jsonMatch[1];
  const prefixMatch = raw.match(/^[\w\s]+error:\s*(.+)/i);
  if (prefixMatch) return prefixMatch[1];
  return raw;
}
