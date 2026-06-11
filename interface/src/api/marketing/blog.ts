/**
 * Browser-side client for the public marketing `/blog` site.
 *
 * Mirrors the other unauthenticated marketing fetchers (see
 * `api/marketing/feedback.ts`): the SPA talks to its own origin's
 * `aura-os-server` public endpoints (added in Phase 3) and no JWT is
 * attached. The markdown BODY is NOT part of the JSON payload — it lives
 * at the post's public S3 `bodyUrl`, fetched separately with `fetchBlogBody`.
 *
 * Endpoint contract:
 *   - GET `/api/public/blog`        -> array of published posts (camelCase
 *     `StorageNote` shape), newest `publishedAt` first.
 *   - GET `/api/public/blog/:slug`  -> single published post (404 if none).
 */

import { resolvePublicContentApiUrl } from "../../shared/lib/host-config";

/**
 * Public, camelCase projection of a published `StorageNote` blog post as
 * served by `GET /api/public/blog`. The markdown body is intentionally
 * absent (fetch it from `bodyUrl`).
 */
export interface BlogPost {
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
  readonly heroImageUrl: string | null;
  readonly readTimeMinutes: number;
  readonly publishedAt: string | null;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly authorAvatarUrl: string | null;
  readonly sections: readonly unknown[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Thrown by `fetchBlogPost` when the server returns 404 for a slug so the
 * view can render its dedicated "post not found" state instead of a
 * generic error.
 */
export class BlogPostNotFoundError extends Error {
  constructor(slug: string) {
    super(`Blog post not found: ${slug}`);
    this.name = "BlogPostNotFoundError";
  }
}

/**
 * Fetch every published blog post, newest `publishedAt` first. Network /
 * parse failures are absorbed to an empty array (same posture as
 * `listFeedback`), so React Query callers render the empty branch rather
 * than an error screen.
 */
export async function fetchBlogPosts(): Promise<BlogPost[]> {
  const url = resolvePublicContentApiUrl("/api/public/blog");

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[blog] GET ${url} failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const json = (await res.json()) as BlogPost[];
    if (!Array.isArray(json)) {
      console.error("[blog] expected array response, got:", typeof json);
      return [];
    }
    return json;
  } catch (err) {
    console.error("[blog] fetchBlogPosts failed", err);
    return [];
  }
}

/**
 * Fetch a single published post by slug. Throws `BlogPostNotFoundError`
 * on 404 and a generic `Error` on any other non-OK response so the two
 * cases can be distinguished in the view.
 */
export async function fetchBlogPost(slug: string): Promise<BlogPost> {
  const url = resolvePublicContentApiUrl(
    `/api/public/blog/${encodeURIComponent(slug)}`,
  );
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) {
    throw new BlogPostNotFoundError(slug);
  }
  if (!res.ok) {
    throw new Error(`[blog] GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as BlogPost;
}

/**
 * Fetch the raw markdown body for a post from its public S3 `bodyUrl`.
 * Returns an empty string on failure so the body section degrades to a
 * blank reading column rather than throwing.
 */
export async function fetchBlogBody(bodyUrl: string): Promise<string> {
  try {
    const res = await fetch(bodyUrl);
    if (!res.ok) {
      console.error(
        `[blog] GET body ${bodyUrl} failed: ${res.status} ${res.statusText}`,
      );
      return "";
    }
    return await res.text();
  } catch (err) {
    console.error("[blog] fetchBlogBody failed", err);
    return "";
  }
}
