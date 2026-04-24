export function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (isPlainObject(input)) {
    return input;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (isPlainObject(parsed)) {
          return parsed;
        }
      } catch {
        // Fall through to preserving the original string for diagnostics.
      }
    }

    return { raw_input: input };
  }

  if (input == null) {
    return {};
  }

  return { raw_input: input };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
