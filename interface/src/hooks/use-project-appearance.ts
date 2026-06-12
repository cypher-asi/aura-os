import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useProjectAppearanceStore } from "../stores/project-appearance-store";
import {
  projectBackgroundImageUrl,
  projectBannerUrl,
} from "../shared/api/appearance";
import { getStoredJwt } from "../shared/lib/auth-token";
import type { ProjectAppearance } from "../shared/api/appearance";

/**
 * Append the current JWT as a `?token=` query param so a bare
 * `<img src=...>` can authenticate against the protected API routes.
 * Browsers don't include `Authorization` on `<img>` requests, but the
 * server's `extract_request_token` accepts the query-param fallback
 * (originally added for WebSockets; mirrors the
 * `aura3d-store::withToken` pattern used for artifact thumbnails).
 */
function withToken(url: string): string {
  const jwt = getStoredJwt();
  if (!jwt) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(jwt)}`;
}

/**
 * Read-and-write hook for a single project's appearance. Triggers a
 * load on first mount, then keeps the consumer subscribed to the
 * store entry for live updates from anywhere else in the app (e.g.
 * the settings modal saves accent → the sidebar's pip recolors in
 * the same tick).
 *
 * Returns `undefined` for `projectId === null` so callers in
 * not-yet-routed contexts (e.g. the projects list) can call the hook
 * unconditionally.
 */
export interface UseProjectAppearanceResult {
  appearance: ProjectAppearance;
  loaded: boolean;
  loading: boolean;
  /** URL to the project's banner image, with a cache-bust query
   *  param that flips on upload/delete so `<img>` re-fetches. The URL
   *  always points at the same endpoint regardless of whether a
   *  banner is set — the consumer should treat a 404 as "no banner". */
  bannerUrl: string;
  /** Same as `bannerUrl` but for the project's `pattern: "image"`
   *  background. Cache-busted on upload/delete via a separate version
   *  counter so the two assets don't invalidate each other. */
  backgroundImageUrl: string;
  update: (next: ProjectAppearance) => Promise<void>;
  uploadBanner: (blob: Blob) => Promise<void>;
  deleteBanner: () => Promise<void>;
  uploadBackgroundImage: (blob: Blob) => Promise<void>;
  deleteBackgroundImage: () => Promise<void>;
}

export function useProjectAppearance(
  projectId: string | null | undefined,
): UseProjectAppearanceResult {
  const load = useProjectAppearanceStore((s) => s.load);

  useEffect(() => {
    if (!projectId) return;
    // Swallow load failures so a transient network error (or a test
    // environment without `fetch` wiring) can't crash the surrounding
    // tree. Appearance is a non-critical UI customization; when it
    // fails to load the project just renders with defaults.
    load(projectId).catch((err) => {
      console.warn("Failed to load project appearance:", err);
    });
  }, [projectId, load]);

  const entry = useProjectAppearanceStore(
    useShallow((s) => {
      if (!projectId) return null;
      return s.entries.get(projectId) ?? null;
    }),
  );

  const updateStore = useProjectAppearanceStore((s) => s.update);
  const uploadBannerStore = useProjectAppearanceStore((s) => s.uploadBanner);
  const deleteBannerStore = useProjectAppearanceStore((s) => s.deleteBanner);
  const uploadBgImageStore = useProjectAppearanceStore(
    (s) => s.uploadBackgroundImage,
  );
  const deleteBgImageStore = useProjectAppearanceStore(
    (s) => s.deleteBackgroundImage,
  );

  const appearance = entry?.appearance ?? {};
  const bannerVersion = entry?.bannerVersion ?? 0;
  const backgroundImageVersion = entry?.backgroundImageVersion ?? 0;

  return {
    appearance,
    loaded: entry?.loaded ?? false,
    loading: entry?.loading ?? false,
    bannerUrl: projectId
      ? withToken(`${projectBannerUrl(projectId)}?v=${bannerVersion}`)
      : "",
    backgroundImageUrl: projectId
      ? withToken(
          `${projectBackgroundImageUrl(projectId)}?v=${backgroundImageVersion}`,
        )
      : "",
    update: async (next) => {
      if (!projectId) return;
      await updateStore(projectId, next);
    },
    uploadBanner: async (blob) => {
      if (!projectId) return;
      await uploadBannerStore(projectId, blob);
    },
    deleteBanner: async () => {
      if (!projectId) return;
      await deleteBannerStore(projectId);
    },
    uploadBackgroundImage: async (blob) => {
      if (!projectId) return;
      await uploadBgImageStore(projectId, blob);
    },
    deleteBackgroundImage: async () => {
      if (!projectId) return;
      await deleteBgImageStore(projectId);
    },
  };
}
