/**
 * Browser-side client for the public documentation site (`/docs`).
 *
 * Mirrors `api/marketing/os.ts`: resolves via `resolvePublicContentApiUrl`,
 * which is prod-pinned in dev. The local server usually has no storage /
 * internal token configured, so dev builds read the published docs from
 * prod (`https://api.aura.ai`) instead of the empty/unauthenticated local
 * server; production builds keep their normal same-origin / configured-host
 * behavior. No JWT is attached. The markdown BODY is NOT part of the JSON
 * payload — it lives at the page's public S3 `bodyUrl`, fetched separately
 * with `fetchDocsBody`.
 *
 * Endpoint contract:
 *   - GET `/api/public/docs`        -> array of published doc pages
 *     (camelCase `StorageNote` shape), in authored (`sortOrder`) order.
 *   - GET `/api/public/docs/:slug`  -> single published page (404 if none).
 */

import { resolvePublicContentApiUrl } from "../../shared/lib/host-config";

/**
 * Public, camelCase projection of a published documentation page. The
 * markdown body is intentionally absent (fetch it from `bodyUrl`). The
 * `blogType` field doubles as the repository/section group key on `/docs`.
 */
export interface DocsDoc {
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
 * Thrown by `fetchDocsDoc` when the server returns 404 for a slug so the
 * view can render its dedicated "not found" state.
 */
export class DocsDocNotFoundError extends Error {
  constructor(slug: string) {
    super(`Doc page not found: ${slug}`);
    this.name = "DocsDocNotFoundError";
  }
}

/**
 * Fetch every published doc page in authored order. Network / parse
 * failures are absorbed to an empty array so React Query callers render
 * the empty branch rather than an error screen.
 */
export async function fetchDocsDocs(): Promise<DocsDoc[]> {
  const url = resolvePublicContentApiUrl("/api/public/docs");

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(
        `[docs] GET ${url} failed: ${res.status} ${res.statusText}`,
      );
      return [];
    }
    const json = (await res.json()) as DocsDoc[];
    if (!Array.isArray(json)) {
      console.error("[docs] expected array response, got:", typeof json);
      return [];
    }
    return json;
  } catch (err) {
    console.error("[docs] fetchDocsDocs failed", err);
    return [];
  }
}

/**
 * Fetch a single published page by slug. Throws `DocsDocNotFoundError`
 * on 404 and a generic `Error` on any other non-OK response.
 */
export async function fetchDocsDoc(slug: string): Promise<DocsDoc> {
  const url = resolvePublicContentApiUrl(
    `/api/public/docs/${encodeURIComponent(slug)}`,
  );
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) {
    throw new DocsDocNotFoundError(slug);
  }
  if (!res.ok) {
    throw new Error(`[docs] GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as DocsDoc;
}

/**
 * Fetch the raw markdown body for a page from its public S3 `bodyUrl`.
 * Returns an empty string on failure so the body degrades to a blank
 * reading column rather than throwing.
 */
export async function fetchDocsBody(bodyUrl: string): Promise<string> {
  try {
    const res = await fetch(bodyUrl);
    if (!res.ok) {
      console.error(
        `[docs] GET body ${bodyUrl} failed: ${res.status} ${res.statusText}`,
      );
      return "";
    }
    return await res.text();
  } catch (err) {
    console.error("[docs] fetchDocsBody failed", err);
    return "";
  }
}
