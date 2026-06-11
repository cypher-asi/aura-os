/**
 * Browser-side client for the public marketing `/os` whitepaper site.
 *
 * Mirrors `api/marketing/blog.ts`: resolves via `resolvePublicContentApiUrl`,
 * which is prod-pinned in dev. The local server usually has no whitepaper
 * seeded, so dev builds read the published whitepaper from prod
 * (`https://api.aura.ai`) instead of the empty local/same-origin server;
 * production builds keep their normal same-origin / configured-host behavior.
 * No JWT is attached. The markdown BODY is NOT part of the JSON payload — it
 * lives at the section's public S3 `bodyUrl`, fetched separately with
 * `fetchOsBody`.
 *
 * Endpoint contract:
 *   - GET `/api/public/os`        -> array of published whitepaper sections
 *     (camelCase `StorageNote` shape), in authored (`sortOrder`) order.
 *   - GET `/api/public/os/:slug`  -> single published section (404 if none).
 */

import { resolvePublicContentApiUrl } from "../../shared/lib/host-config";

/**
 * Public, camelCase projection of a published whitepaper section. The
 * markdown body is intentionally absent (fetch it from `bodyUrl`). The
 * `blogType` field doubles as the collapsible section key on `/os`.
 */
export interface OsDoc {
  readonly id: string;
  readonly projectId: string;
  readonly folderId: string | null;
  readonly title: string;
  readonly slug: string;
  readonly sortOrder: number;
  readonly wordCount: number;
  readonly bodyUrl: string;
  readonly bodyS3Key: string;
  readonly status: string;
  readonly blogType: string;
  readonly excerpt: string | null;
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Thrown by `fetchOsDoc` when the server returns 404 for a slug so the
 * view can render its dedicated "not found" state.
 */
export class OsDocNotFoundError extends Error {
  constructor(slug: string) {
    super(`Whitepaper section not found: ${slug}`);
    this.name = "OsDocNotFoundError";
  }
}

/**
 * Fetch every published whitepaper section in authored order. Network /
 * parse failures are absorbed to an empty array so React Query callers
 * render the empty branch rather than an error screen.
 */
export async function fetchOsDocs(): Promise<OsDoc[]> {
  const url = resolvePublicContentApiUrl("/api/public/os");

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[os] GET ${url} failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const json = (await res.json()) as OsDoc[];
    if (!Array.isArray(json)) {
      console.error("[os] expected array response, got:", typeof json);
      return [];
    }
    return json;
  } catch (err) {
    console.error("[os] fetchOsDocs failed", err);
    return [];
  }
}

/**
 * Fetch a single published section by slug. Throws `OsDocNotFoundError`
 * on 404 and a generic `Error` on any other non-OK response.
 */
export async function fetchOsDoc(slug: string): Promise<OsDoc> {
  const url = resolvePublicContentApiUrl(
    `/api/public/os/${encodeURIComponent(slug)}`,
  );
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) {
    throw new OsDocNotFoundError(slug);
  }
  if (!res.ok) {
    throw new Error(`[os] GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as OsDoc;
}

/**
 * Fetch the raw markdown body for a section from its public S3 `bodyUrl`.
 * Returns an empty string on failure so the body degrades to a blank
 * reading column rather than throwing.
 */
export async function fetchOsBody(bodyUrl: string): Promise<string> {
  try {
    const res = await fetch(bodyUrl);
    if (!res.ok) {
      console.error(
        `[os] GET body ${bodyUrl} failed: ${res.status} ${res.statusText}`,
      );
      return "";
    }
    return await res.text();
  } catch (err) {
    console.error("[os] fetchOsBody failed", err);
    return "";
  }
}
