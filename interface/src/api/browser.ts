import { authHeaders, getStoredJwt } from "../lib/auth-token";
import { resolveApiUrl, resolveWsUrl } from "../lib/host-config";
import { ApiClientError } from "./core";
import type { ApiError } from "../types";

// ---------------------------------------------------------------------------
// DTOs shared with aura-os-server's /api/browser endpoints.
// ---------------------------------------------------------------------------

export type DetectionSource = "terminal" | "probe" | "manual";

export interface DetectedUrl {
  url: string;
  source: DetectionSource;
  at: string;
}

export interface HistoryEntry {
  url: string;
  title: string | null;
  at: string;
}

export interface ProjectBrowserSettings {
  schema_version: number;
  pinned_url: string | null;
  last_url: string | null;
  detected_urls: DetectedUrl[];
  history: HistoryEntry[];
}

export interface SessionInfo {
  id: string;
  project_id: string | null;
  initial_url: string | null;
  created_at: string;
}

export interface SpawnBrowserRequest {
  width: number;
  height: number;
  projectId?: string;
  initialUrl?: string;
}

export interface SpawnBrowserResponse {
  id: string;
  initial_url: string | null;
  focus_address_bar: boolean;
}

/**
 * Partial update document for PUT /api/browser/projects/:id/settings.
 *
 * `pinned_url: null` explicitly clears the pin; `undefined` leaves it alone.
 */
export interface BrowserSettingsPatch {
  pinned_url?: string | null;
  clear_history?: boolean;
  clear_detected?: boolean;
}

// ---------------------------------------------------------------------------
// Binary frame protocol (C <-> S hot path).
//
// Header (9 bytes, little-endian):
//   0   u8   opcode (0x01)
//   1   u32  seq
//   5   u16  width
//   7   u16  height
// then the JPEG payload.
// ---------------------------------------------------------------------------

export const FRAME_OPCODE = 0x01;
export const FRAME_HEADER_LEN = 9;
const FRAME_ACK_OPCODE_LEN = 4;

export interface FrameHeader {
  seq: number;
  width: number;
  height: number;
}

export interface DecodedFrame {
  header: FrameHeader;
  jpeg: Uint8Array;
}

export function decodeBinaryFrame(buffer: ArrayBuffer): DecodedFrame | null {
  if (buffer.byteLength < FRAME_HEADER_LEN) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== FRAME_OPCODE) return null;
  const seq = view.getUint32(1, true);
  const width = view.getUint16(5, true);
  const height = view.getUint16(7, true);
  return {
    header: { seq, width, height },
    jpeg: new Uint8Array(buffer, FRAME_HEADER_LEN),
  };
}

export function encodeFrameAck(seq: number): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_ACK_OPCODE_LEN);
  new DataView(buf).setUint32(0, seq >>> 0, true);
  return buf;
}

// ---------------------------------------------------------------------------
// Control-channel messages (JSON text).
// ---------------------------------------------------------------------------

export type MouseButton = "left" | "middle" | "right" | "none";
export type MouseEventKind = "move" | "down" | "up";

export interface NavState {
  url: string;
  title: string | null;
  can_go_back: boolean;
  can_go_forward: boolean;
  loading: boolean;
}

export type BrowserClientMsg =
  | { type: "navigate"; url: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "resize"; width: number; height: number }
  | {
      type: "mouse";
      event: MouseEventKind;
      x: number;
      y: number;
      button?: MouseButton;
      modifiers?: number;
      click_count?: number;
    }
  | {
      type: "key";
      event: "down" | "up";
      key: string;
      code: string;
      text?: string | null;
      modifiers?: number;
    }
  | {
      type: "wheel";
      x: number;
      y: number;
      delta_x: number;
      delta_y: number;
    };

export type BrowserServerTextEvent =
  | { type: "nav"; nav: NavState }
  | { type: "exit"; code: number };

export function isBrowserServerTextEvent(
  value: unknown,
): value is BrowserServerTextEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  if (type === "nav") {
    const nav = (value as { nav?: unknown }).nav;
    return Boolean(nav && typeof nav === "object");
  }
  if (type === "exit") return true;
  return false;
}

// ---------------------------------------------------------------------------
// REST helpers.
// ---------------------------------------------------------------------------

async function throwApiError(res: Response): Promise<never> {
  const err: ApiError = await res.json().catch(() => ({
    error: res.statusText,
    code: "unknown",
    details: null,
  }));
  throw new ApiClientError(res.status, err);
}

export async function spawnBrowser(
  req: SpawnBrowserRequest,
): Promise<SpawnBrowserResponse> {
  const body: Record<string, unknown> = {
    width: req.width,
    height: req.height,
  };
  if (req.projectId) body.project_id = req.projectId;
  if (req.initialUrl) body.initial_url = req.initialUrl;

  const res = await fetch(resolveApiUrl("/api/browser"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function listBrowsers(): Promise<SessionInfo[]> {
  const res = await fetch(resolveApiUrl("/api/browser"), {
    headers: authHeaders(),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function killBrowser(id: string): Promise<void> {
  const res = await fetch(resolveApiUrl(`/api/browser/${id}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    await throwApiError(res);
  }
}

export async function getProjectBrowserSettings(
  projectId: string,
): Promise<ProjectBrowserSettings> {
  const res = await fetch(
    resolveApiUrl(`/api/browser/projects/${projectId}/settings`),
    { headers: authHeaders() },
  );
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function updateProjectBrowserSettings(
  projectId: string,
  patch: BrowserSettingsPatch,
): Promise<ProjectBrowserSettings> {
  const res = await fetch(
    resolveApiUrl(`/api/browser/projects/${projectId}/settings`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function triggerBrowserDetect(
  projectId: string,
): Promise<DetectedUrl[]> {
  const res = await fetch(
    resolveApiUrl(`/api/browser/projects/${projectId}/detect`),
    {
      method: "POST",
      headers: authHeaders(),
    },
  );
  if (!res.ok) await throwApiError(res);
  const body: { detected: DetectedUrl[] } = await res.json();
  return body.detected;
}

function appendWsToken(url: string): string {
  const jwt = getStoredJwt();
  if (!jwt) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(jwt)}`;
}

export function browserWsUrl(id: string): string {
  return appendWsToken(resolveWsUrl(`/ws/browser/${id}`));
}
