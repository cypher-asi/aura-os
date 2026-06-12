import { ApiClientError, apiFetch } from "./core";
import { authHeaders } from "../../shared/lib/auth-token";
import { resolveApiUrl } from "../../shared/lib/host-config";
import type { ApiError } from "../types";

/**
 * Per-project visual customization persisted as
 * `<workspace>/.aura/appearance.json` on the server. Every field is
 * optional — a brand-new project returns an empty object, and the UI
 * treats unset values as "use the default."
 */
export interface ProjectAppearance {
  /** Hex color like `#7c3aed`. */
  accent?: string;
  /** Where the accent stripe paints relative to the project header row.
   *  Defaults to `"left"` when unset (matches the original treatment).
   *  Only honored when `accent` is set and neither `headerOutline` nor
   *  `headerBackground` is set — those override the stripe. */
  accentPosition?: "left" | "bottom";
  /** Lucide icon name, e.g. `"Rocket"`. */
  icon?: string;
  /** Hex color applied to the project's display name in the sidebar
   *  row and modal preview. Distinct from `accent` so users can tint
   *  the glyph in one color and the text in another. */
  nameColor?: string;
  /** When true, the banner image renders with `object-fit: contain`
   *  (scale-to-fit, letterboxed) instead of the default `cover`. The
   *  source image is uploaded at its native aspect — no cropping
   *  during upload — so the full image is always preserved. */
  bannerScaleToFit?: boolean;
  /** Hex color for the sidebar project-header row's background fill.
   *  Applied to the row container so it reads as a chip/pill around
   *  the icon + name. */
  headerBackground?: string;
  /** Hex color for the sidebar project-header row's outline. Applied
   *  as a 1px border around the row container, independent of
   *  `headerBackground` so users can outline-only or fill-only. */
  headerOutline?: string;
  background?: {
    /** Hex color for the background tint. */
    color?: string;
    /** Background style. `solid` paints just the color; the named
     *  patterns overlay onto the color; `image` shows the user's
     *  uploaded image (served from the `/background-image` endpoint).
     *  Legacy `none` still accepted for compatibility with v1 saves. */
    pattern?:
      | "none"
      | "solid"
      | "dots"
      | "grid"
      | "diagonal"
      | "noise"
      | "radial"
      | "image";
    /** 0..1. Applied uniformly across the color + pattern/image
     *  composite so the slider scales the entire background. */
    opacity?: number;
    /** When true, flip the chosen style so it does the opposite:
     *  - `dots / grid / diagonal / radial`: the figure becomes the
     *    transparent cut-out and the surrounding area paints in the
     *    chosen color (so a "dot" becomes a hole through a colored
     *    field).
     *  - `image`: applies `filter: invert(1)` to the rendered image.
     *  - `noise`: applies `filter: invert(1)` to the grain.
     *  - `solid`: no-op (there's nothing to invert).
     */
    invert?: boolean;
    /** When true, render a frosted-glass layer between the
     *  background (color + pattern/image) and the content. The
     *  blur softens the background, which helps content readability
     *  on busy images / strong colors. */
    frost?: boolean;
    /** Blur radius in pixels for the frosted overlay (1–30). Only
     *  used when `frost: true`. Falls back to 8 when unset. */
    frostAmount?: number;
    /** Tile / repeat scale for the geometric patterns (dots, grid,
     *  diagonal, noise, radial). Unitless multiplier — `1` is the
     *  default visual size; `0.25` is one-quarter, `4` is four
     *  times. Ignored for `solid` (no tile) and `image`
     *  (`object-fit: cover` already covers any size). */
    patternSize?: number;
  };
}

export interface UploadBannerResponse {
  bannerUrl: string;
}

export interface UploadBackgroundImageResponse {
  backgroundImageUrl: string;
}

/**
 * Build the GET URL for a project's banner. Always returns the same
 * path regardless of underlying file extension — the server probes
 * `.png` then `.jpg` and returns the right content type, so callers
 * can use this URL as an `<img src>` without knowing the format.
 *
 * The frontend should treat a 404 from this URL as "no banner set"
 * and render a fallback header instead of an error.
 */
export function projectBannerUrl(projectId: string): string {
  return resolveApiUrl(`/api/projects/${projectId}/appearance/banner`);
}

/**
 * Same shape as `projectBannerUrl` but for the project's background
 * image (`pattern: "image"`).
 */
export function projectBackgroundImageUrl(projectId: string): string {
  return resolveApiUrl(`/api/projects/${projectId}/appearance/background-image`);
}

export const appearanceApi = {
  /**
   * Fetch the project's appearance JSON. Returns `{}` (an empty
   * object) when the project has no customization yet — callers don't
   * need to special-case 404.
   */
  get: (projectId: string) =>
    apiFetch<ProjectAppearance>(`/api/projects/${projectId}/appearance`),

  /**
   * Replace the project's appearance JSON wholesale. The server
   * doesn't merge — callers pass the full desired shape and the
   * server writes it atomically.
   */
  update: (projectId: string, appearance: ProjectAppearance) =>
    apiFetch<ProjectAppearance>(`/api/projects/${projectId}/appearance`, {
      method: "PUT",
      body: JSON.stringify(appearance),
    }),

  /**
   * Upload a PNG or JPEG banner. Sends the raw blob with the right
   * MIME type so the server can stream straight to disk without
   * base64 round-tripping. Magic bytes are validated server-side.
   */
  uploadBanner: async (
    projectId: string,
    blob: Blob,
  ): Promise<UploadBannerResponse> => {
    const res = await fetch(
      resolveApiUrl(`/api/projects/${projectId}/appearance/banner`),
      {
        method: "PUT",
        headers: {
          "Content-Type": blob.type || "application/octet-stream",
          ...authHeaders(),
        },
        body: blob,
      },
    );
    if (!res.ok) {
      const err: ApiError = await res.json().catch(() => ({
        error: res.statusText,
        code: "unknown",
        details: null,
      }));
      throw new ApiClientError(res.status, err);
    }
    return res.json();
  },

  deleteBanner: (projectId: string) =>
    apiFetch<{ deleted: boolean }>(
      `/api/projects/${projectId}/appearance/banner`,
      { method: "DELETE" },
    ),

  /**
   * Upload a PNG or JPEG used as the project's `pattern: "image"`
   * background. Mirrors `uploadBanner` end-to-end.
   */
  uploadBackgroundImage: async (
    projectId: string,
    blob: Blob,
  ): Promise<UploadBackgroundImageResponse> => {
    const res = await fetch(
      resolveApiUrl(`/api/projects/${projectId}/appearance/background-image`),
      {
        method: "PUT",
        headers: {
          "Content-Type": blob.type || "application/octet-stream",
          ...authHeaders(),
        },
        body: blob,
      },
    );
    if (!res.ok) {
      const err: ApiError = await res.json().catch(() => ({
        error: res.statusText,
        code: "unknown",
        details: null,
      }));
      throw new ApiClientError(res.status, err);
    }
    return res.json();
  },

  deleteBackgroundImage: (projectId: string) =>
    apiFetch<{ deleted: boolean }>(
      `/api/projects/${projectId}/appearance/background-image`,
      { method: "DELETE" },
    ),
};
