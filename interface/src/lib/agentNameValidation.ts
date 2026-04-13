export function hasSupportedAgentName(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

export function getAgentNameValidationMessage(
  nextName: string,
  previousName?: string | null,
): string {
  const trimmed = nextName.trim();
  if (!trimmed) {
    return "Name is required";
  }

  const trimmedPrevious = previousName?.trim() ?? "";
  if (trimmedPrevious && trimmed === trimmedPrevious) {
    return "";
  }

  return hasSupportedAgentName(trimmed)
    ? ""
    : "Use only letters, numbers, hyphens, or underscores";
}
