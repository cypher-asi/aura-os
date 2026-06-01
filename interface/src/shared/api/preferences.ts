import { apiFetch } from "./core";

/**
 * App-wide / per-user preferences client. The server persists each
 * feature opaquely under a `preferences:<feature>` key (see
 * `apps/aura-os-server/src/handlers/preferences/`), so the wire shape
 * is owned by the frontend type for that feature.
 *
 * This module is the shared **skeleton**: it exposes generic
 * `getPref` / `putPref` / `deletePref` helpers and an empty
 * `preferencesApi` namespace. Each preference feature extends
 * `preferencesApi` with typed `get<Feature>` / `put<Feature>` methods
 * (thin wrappers over the generic helpers) and defines its own
 * `<Feature>Prefs` interface here.
 *
 * Convention: path `/api/preferences/<feature-kebab>`. GET returns the
 * feature's default when unset (the server never 404s a preference
 * read), PUT writes and echoes the stored shape, DELETE resets to
 * default.
 */

const PREFERENCES_BASE = "/api/preferences";

/** Read a preference. The server returns the feature default when unset. */
export function getPref<T>(featureKebab: string): Promise<T> {
  return apiFetch(`${PREFERENCES_BASE}/${featureKebab}`);
}

/** Write a preference; resolves to the server's echoed (authoritative) shape. */
export function putPref<T>(featureKebab: string, prefs: T): Promise<T> {
  return apiFetch(`${PREFERENCES_BASE}/${featureKebab}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

/** Reset a preference to its default (server deletes the stored key). */
export function deletePref(featureKebab: string): Promise<void> {
  return apiFetch(`${PREFERENCES_BASE}/${featureKebab}`, { method: "DELETE" });
}

/**
 * Typed preference methods. Feature PRs extend this object with
 * `get<Feature>` / `put<Feature>` (and optionally `delete<Feature>`)
 * wrappers — see `getPref` / `putPref` / `deletePref` above.
 */
export const preferencesApi = {};
