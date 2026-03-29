import { apiFetch } from "./core";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: DirEntry[];
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
    apiFetch<{ update: { status: string; version?: string; channel?: string; error?: string }; channel: string; current_version: string }>(
      "/api/update-status",
    ),
  installUpdate: () =>
    apiFetch<{ ok: boolean; error?: string }>("/api/update-install", {
      method: "POST",
    }),
  setUpdateChannel: (channel: "stable" | "nightly") =>
    apiFetch<{ ok: boolean; channel: string }>("/api/update-channel", {
      method: "POST",
      body: JSON.stringify({ channel }),
    }),
};
