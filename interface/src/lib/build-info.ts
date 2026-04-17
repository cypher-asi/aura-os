export type BuildChannel = "stable" | "nightly" | "dev" | string;

export interface BuildInfo {
  version: string;
  commit: string;
  buildTime: string;
  channel: BuildChannel;
  isDev: boolean;
}

function safeRead(value: string | undefined, fallback: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return fallback;
}

export function getBuildInfo(): BuildInfo {
  const version = safeRead(
    typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
    "0.0.0",
  );
  const commit = safeRead(
    typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : undefined,
    "local",
  );
  const buildTime = safeRead(
    typeof __APP_BUILD_TIME__ !== "undefined" ? __APP_BUILD_TIME__ : undefined,
    "dev",
  );
  const channel = safeRead(
    typeof __APP_CHANNEL__ !== "undefined" ? __APP_CHANNEL__ : undefined,
    "dev",
  );

  return {
    version,
    commit,
    buildTime,
    channel,
    isDev: buildTime === "dev" || channel === "dev",
  };
}

export function formatBuildTime(buildTime: string, locale?: string): string {
  if (!buildTime || buildTime === "dev") {
    return "Development build";
  }
  const parsed = new Date(buildTime);
  if (Number.isNaN(parsed.getTime())) {
    return buildTime;
  }
  return parsed.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
