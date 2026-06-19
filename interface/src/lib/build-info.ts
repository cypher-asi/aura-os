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

export type AppPlatform = "desktop" | "web" | "mobile";

/**
 * Resolve the build-time app version. Mirrors the `app_version` super
 * property the Mixpanel SDK registers, and is the value sent to the
 * server via the `X-App-Version` header so server-emitted analytics
 * events carry a real version instead of "(not set)".
 */
export function getAppVersion(): string {
  // The web frontend is continuously redeployed, so its baked version is a
  // per-deploy commit SHA (Render stamps APP_VERSION=$RENDER_GIT_COMMIT),
  // which floods Mixpanel's app_version with a new hash per deploy. Web is a
  // single rolling surface, so it reports the unversioned 0.0.0 label — one
  // line in analytics. The exact build stays recoverable via
  // getBuildInfo().commit (e.g. bug reports). Desktop/mobile keep their real
  // baked release version.
  if (getAppPlatform() === "web") return "0.0.0";
  return safeRead(typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined, "0.0.0");
}

/**
 * Detect whether we're running in the Electron desktop shell, the
 * Capacitor mobile shell, or a plain web browser. Single source of
 * truth shared by analytics and the API client.
 */
export function getAppPlatform(): AppPlatform {
  if (typeof window === "undefined") return "web";
  // Electron desktop app
  if ("ipc" in window && typeof (window as unknown as Record<string, unknown>).ipc === "object") {
    return "desktop";
  }
  // Capacitor mobile app
  if ("Capacitor" in window) {
    return "mobile";
  }
  return "web";
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
