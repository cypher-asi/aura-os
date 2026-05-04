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

export interface PersistDesktopRouteResponse {
  ok: boolean;
  route?: string;
  error?: string;
}

export const desktopApi = {
  getLogEntries: (limit = 1000) =>
    apiFetch<{ timestamp_ms: number; event: import("../types/aura-events").AuraEvent }[]>(
      `/api/log-entries?limit=${limit}`,
    ),
  listDirectory: (path: string) =>
    apiFetch<{ ok: boolean; entries?: DirEntry[]; error?: string }>("/api/list-directory", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  pickFolder: () =>
    apiFetch<string | null>("/api/pick-folder", { method: "POST" }),
  pickFile: () =>
    apiFetch<string | null>("/api/pick-file", { method: "POST" }),
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
  openIde: (path: string, root?: string) =>
    apiFetch<{ ok: boolean }>("/api/open-ide", {
      method: "POST",
      body: JSON.stringify({ path, root }),
    }),
  readFile: (path: string) =>
    apiFetch<{ ok: boolean; content?: string; path?: string; error?: string }>("/api/read-file", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  writeFile: (path: string, content: string) =>
    apiFetch<{ ok: boolean; path?: string; error?: string }>("/api/write-file", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    }),
  getUpdateStatus: () =>
    apiFetch<DesktopUpdateStatusResponse>(
      "/api/update-status",
    ),
  installUpdate: () =>
    apiFetch<{ ok: boolean; error?: string }>("/api/update-install", {
      method: "POST",
    }),
  checkForUpdates: () =>
    apiFetch<{ ok: boolean; error?: string }>("/api/update-check", {
      method: "POST",
    }),
  setUpdateChannel: (channel: DesktopUpdateChannel) =>
    apiFetch<{ ok: boolean; channel: DesktopUpdateChannel; error?: string }>("/api/update-channel", {
      method: "POST",
      body: JSON.stringify({ channel }),
    }),
  revealUpdateLogs: () =>
    apiFetch<{ ok: boolean; path?: string; updater_log?: string; error?: string }>(
      "/api/update-reveal-logs",
      { method: "POST" },
    ),
  stageUpdateOnly: () =>
    apiFetch<{ ok: boolean; staged_path?: string; error?: string }>(
      "/api/update-stage-only",
      { method: "POST" },
    ),
};
