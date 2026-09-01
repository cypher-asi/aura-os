export interface IdeNavigationState {
  returnTo: string;
}

function isSafeAppPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    value !== "/ide" &&
    !value.startsWith("/ide?") &&
    !value.startsWith("/ide#")
  );
}

export function buildIdeNavigationState(
  pathname: string,
  search = "",
  hash = "",
): IdeNavigationState {
  return { returnTo: `${pathname}${search}${hash}` };
}

export function resolveIdeReturnPath(
  state: unknown,
  fallbackPath = "/projects",
): string {
  const returnTo =
    state && typeof state === "object" && "returnTo" in state
      ? (state as { returnTo?: unknown }).returnTo
      : undefined;

  if (isSafeAppPath(returnTo)) return returnTo;
  return isSafeAppPath(fallbackPath) ? fallbackPath : "/projects";
}
