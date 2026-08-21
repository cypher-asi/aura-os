import { apiFetch } from "./core";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: DirEntry[];
}

export type DesktopUpdateChannel = "stable" | "nightly";

export interface DesktopUpdateState {
  status: string;
  version?: string;
  channel?: DesktopUpdateChannel;
  error?: string;
  /**
   * Stable identifier for the last completed/failed step in the install
   * pipeline (`download_started`, `handoff_spawned`, …). Surfaced when
   * `status === "failed"` so users see *where* an install died rather
   * than only an opaque error string.
   */
  last_step?: string;
}

export interface DesktopUpdateDiagnostics {
  updater_log_path: string;
  updater_state_path: string;
}

export interface DesktopUpdatePersistedState {
  status: string;
  step: string;
  ts_unix_ms: number;
  version?: string;
  channel?: string;
  error?: string;
  detail?: string;
}

export interface DesktopUpdateStatusResponse {
  update: DesktopUpdateState;
  channel: DesktopUpdateChannel;
  current_version: string;
  supported?: boolean;
  update_base_url?: string;
  endpoint_template?: string;
  /**
   * Latest snapshot persisted to `<data_dir>/updater-state.json`. Useful for
   * diagnostics even when the in-memory status has been reset to
   * `Idle`/`UpToDate` by a successful reconcile on next boot.
   */
  last_persisted_state?: DesktopUpdatePersistedState | null;
  diagnostics?: DesktopUpdateDiagnostics;
}

/**
 * Classification of the running app bundle. Only carries actionable
 * signal on macOS — `supported` is `false` everywhere else (Windows uses
 * an out-of-process NSIS handoff and Linux replaces an AppImage in
 * place, neither of which has a translocation/read-only-mount story).
 *
 * Surfaced on `Failed` updater states so the UI can detect "Aura is
 * running from `/private/var/.../AppTranslocation/...`" or "Aura is
 * running from `/Volumes/...`" and offer the macOS recovery flow
 * (`relocateAndRelaunch`) instead of just an error message.
 */
export interface DesktopUpdateBundleInfo {
  ok: boolean;
  /** `true` when the running platform is macOS. */
  supported: boolean;
  /** Absolute path to the running `.app` bundle (or executable on
   * non-macOS platforms). */
  path?: string;
  /** Bundle path contains an `AppTranslocation` component — macOS
   * Gatekeeper Path Randomization is active. */
  translocated?: boolean;
  /** Filesystem hosting the bundle has the read-only mount flag set. */
  read_only?: boolean;
  /** Bundle is under `/Volumes/` AND the volume is read-only. */
  on_dmg?: boolean;
  error?: string;
}

export interface PersistDesktopRouteResponse {
  ok: boolean;
  route?: string;
  error?: string;
}

export type BrowserExecutableSource =
  | "saved_setting"
  | "process_environment"
  | "user_environment"
  | "automatic_discovery"
  | "not_found"
  | "unsupported";

export interface BrowserExecutableStatus {
  resolved_path: string | null;
  source: BrowserExecutableSource;
  available: boolean;
}

export interface DesktopScreenshotResponse {
  ok: boolean;
  image_base64?: string;
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Output format for a `/record_demo` clip. `x` produces the framed,
 * X/Twitter-ready H.264 MP4 (window composited onto a background); `raw`
 * keeps the unframed full-monitor capture. Mirrors the backend
 * `target` field on `POST /api/demo-recordings`.
 */
export type RecordTarget = "x" | "raw";

/**
 * 16:10 window-resolution presets for the recorded AURA window. The
 * canvas the window is composited onto stays at the backend X default
 * (1920x1080); these presets only size the captured window so it never
 * needs upscaling. See `RECORD_RESOLUTION_PIXELS`.
 */
export type RecordResolution = "720p" | "1080p" | "1440p";

/**
 * Window logical-pixel size for each resolution preset. Kept 16:10 to
 * match the Phase 1/2 backend defaults (1600x1000 window on a 1920x1080
 * canvas), so the composite never upscales the window:
 *   - `720p`  -> 1280x800
 *   - `1080p` -> 1600x1000 (the backend default window size)
 *   - `1440p` -> 2048x1280
 */
export const RECORD_RESOLUTION_PIXELS: Record<
  RecordResolution,
  { width: number; height: number }
> = {
  "720p": { width: 1280, height: 800 },
  "1080p": { width: 1600, height: 1000 },
  "1440p": { width: 2048, height: 1280 },
};

/**
 * User-chosen knobs for a `/record_demo` run, collected by the
 * `DemoRecordSettings` panel and mapped onto the desktop
 * `POST /api/demo-recordings` body in `startDemoRecording`.
 */
export interface DemoRecordOptions {
  resolution: RecordResolution;
  target: RecordTarget;
  windowOnBackground: boolean;
  /** Absolute path to a custom background image, or `null` for the
   * bundled default background. */
  backgroundPath: string | null;
  /**
   * Let the agent drive the real OS cursor/keyboard across the whole
   * desktop (computer-use). When `true`, the backend forces full-monitor
   * capture and skips the window-on-background composite, so the recording
   * shows authentic OS-wide control rather than the framed window demo.
   */
  computerUse: boolean;
}

/**
 * X-ready defaults: 1080p window, framed X output, composited onto the
 * default bundled background, with computer-use OFF (the framed
 * window-only demo). The panel only overrides these.
 */
export const DEFAULT_DEMO_RECORD_OPTIONS: DemoRecordOptions = {
  resolution: "1080p",
  target: "x",
  windowOnBackground: true,
  backgroundPath: null,
  computerUse: false,
};

/** Machine-readable reason a demo-recording preflight failed, mirroring the
 * backend `PreflightKind`. Drives which remediation flow the setup modal
 * shows. */
export type DemoPreflightKind =
  "ffmpeg_missing" | "screen_recording_permission";

export interface StartDemoRecordingResponse {
  ok: boolean;
  recording_id?: string;
  error?: string;
  kind?: DemoPreflightKind;
}

export const desktopApi = {
  getLogEntries: (limit = 1000) =>
    apiFetch<
      {
        timestamp_ms: number;
        event: import("../types/aura-events").AuraEvent;
      }[]
    >(`/api/log-entries?limit=${limit}`),
  listDirectory: (path: string) =>
    apiFetch<{ ok: boolean; entries?: DirEntry[]; error?: string }>(
      "/api/list-directory",
      {
        method: "POST",
        body: JSON.stringify({ path }),
      },
    ),
  pickFolder: () =>
    apiFetch<string | null>("/api/pick-folder", { method: "POST" }),
  pickFile: () => apiFetch<string | null>("/api/pick-file", { method: "POST" }),
  getBrowserExecutable: () =>
    apiFetch<BrowserExecutableStatus>("/api/browser-executable", {
      sameOrigin: true,
    }),
  setBrowserExecutable: (executablePath: string | null) =>
    apiFetch<BrowserExecutableStatus>("/api/browser-executable", {
      method: "PUT",
      body: JSON.stringify({ executable_path: executablePath }),
      sameOrigin: true,
    }),
  persistLastRoute: (route: string) =>
    apiFetch<PersistDesktopRouteResponse>("/api/last-route", {
      method: "POST",
      body: JSON.stringify({ route }),
    }),
  openPath: (path: string) =>
    apiFetch<{ ok: boolean; error?: string }>("/api/open-path", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  captureScreenshot: () =>
    apiFetch<DesktopScreenshotResponse>("/api/computer/screenshot", {
      method: "POST",
    }),
  openIde: (path: string, root?: string) =>
    apiFetch<{ ok: boolean }>("/api/open-ide", {
      method: "POST",
      body: JSON.stringify({ path, root }),
    }),
  readFile: (path: string) =>
    apiFetch<{ ok: boolean; content?: string; path?: string; error?: string }>(
      "/api/read-file",
      {
        method: "POST",
        body: JSON.stringify({ path }),
      },
    ),
  writeFile: (path: string, content: string) =>
    apiFetch<{ ok: boolean; path?: string; error?: string }>(
      "/api/write-file",
      {
        method: "POST",
        body: JSON.stringify({ path, content }),
      },
    ),
  getUpdateStatus: () =>
    apiFetch<DesktopUpdateStatusResponse>("/api/update-status"),
  installUpdate: () =>
    apiFetch<{ ok: boolean; error?: string }>("/api/update-install", {
      method: "POST",
    }),
  checkForUpdates: () =>
    apiFetch<{ ok: boolean; error?: string }>("/api/update-check", {
      method: "POST",
    }),
  setUpdateChannel: (channel: DesktopUpdateChannel) =>
    apiFetch<{ ok: boolean; channel: DesktopUpdateChannel; error?: string }>(
      "/api/update-channel",
      {
        method: "POST",
        body: JSON.stringify({ channel }),
      },
    ),
  revealUpdateLogs: () =>
    apiFetch<{
      ok: boolean;
      path?: string;
      updater_log?: string;
      error?: string;
    }>("/api/update-reveal-logs", { method: "POST" }),
  stageUpdateOnly: () =>
    apiFetch<{ ok: boolean; staged_path?: string; error?: string }>(
      "/api/update-stage-only",
      { method: "POST" },
    ),
  startDemoRecording: (
    instruction: string,
    options?: DemoRecordOptions,
  ): Promise<StartDemoRecordingResponse> => {
    const pixels = options
      ? RECORD_RESOLUTION_PIXELS[options.resolution]
      : undefined;
    return apiFetch<StartDemoRecordingResponse>("/api/demo-recordings", {
      method: "POST",
      body: JSON.stringify({
        instruction,
        window_width: pixels?.width,
        window_height: pixels?.height,
        target: options?.target,
        background: options?.backgroundPath ?? undefined,
        window_on_background: options?.windowOnBackground,
        computer_use: options?.computerUse,
      }),
    });
  },
  setDemoFfmpegPath: (path: string) =>
    apiFetch<{ ok: boolean; error?: string }>(
      "/api/demo-recordings/ffmpeg-path",
      {
        method: "POST",
        body: JSON.stringify({ path }),
      },
    ),
  openScreenRecordingSettings: () =>
    apiFetch<{ ok: boolean; error?: string }>(
      "/api/demo-recordings/open-screen-recording-settings",
      { method: "POST" },
    ),
  getDemoRecording: (recordingId: string) =>
    apiFetch<{
      ok: boolean;
      recording?: {
        phase: "starting" | "recording" | "finalizing" | "completed" | "failed";
        instruction: string;
        output_path?: string | null;
        error?: string | null;
      };
      error?: string;
    }>(`/api/demo-recordings/${encodeURIComponent(recordingId)}`),
  getUpdateBundleInfo: () =>
    apiFetch<DesktopUpdateBundleInfo>("/api/update-bundle-info"),
  relocateAndRelaunch: () =>
    apiFetch<{ ok: boolean; error?: string }>(
      "/api/update-relocate-and-relaunch",
      { method: "POST" },
    ),
};
