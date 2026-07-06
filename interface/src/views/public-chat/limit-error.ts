const PUBLIC_LIMIT_ERROR_CODES = new Set([
  "limit_reached",
  "public_chat_limit_reached",
]);

export function isPublicLimitReachedError(err: Error): boolean {
  return PUBLIC_LIMIT_ERROR_CODES.has(err.message.trim().toLowerCase());
}
