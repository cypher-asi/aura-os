import { ApiClientError, apiFetch } from "./core";
import { authHeaders } from "../../shared/lib/auth-token";
import { resolveApiUrl } from "../../shared/lib/host-config";
import type { ApiError } from "../types";

export interface ProjectArtifact {
  id: string;
  projectId?: string;
  orgId?: string;
  createdBy?: string;
  type: string;
  name?: string;
  description?: string;
  assetUrl?: string;
  thumbnailUrl?: string;
  originalUrl?: string;
  parentId?: string;
  isIteration?: boolean;
  prompt?: string;
  promptMode?: string;
  model?: string;
  provider?: string;
  meta?: Record<string, unknown>;
  createdAt?: string;
}

export interface CreateProjectArtifactBody {
  type: "image" | "model";
  name: string;
  description?: string;
  assetUrl: string;
  thumbnailUrl?: string;
  originalUrl?: string;
  parentId?: string;
  isIteration?: boolean;
  prompt?: string;
  promptMode?: string;
  model?: string;
  provider?: string;
  meta?: Record<string, unknown>;
}

export interface UploadArtifactThumbnailResponse {
  thumbnailUrl: string;
}

export const artifactsApi = {
  listArtifacts: (projectId: string, type?: "image" | "model") =>
    apiFetch<ProjectArtifact[]>(
      `/api/projects/${projectId}/artifacts${type ? `?type=${type}` : ""}`,
    ),

  createArtifact: (projectId: string, data: CreateProjectArtifactBody) =>
    apiFetch<ProjectArtifact>(`/api/projects/${projectId}/artifacts`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteArtifact: (artifactId: string) =>
    apiFetch<void>(`/api/artifacts/${artifactId}`, { method: "DELETE" }),

  /**
   * Upload a captured PNG snapshot of a 3D model to use as the
   * sidekick tile thumbnail. Sends the raw blob with `image/png`
   * (not JSON / multipart) so the server can stream it straight to
   * disk without base64 round-tripping.
   */
  uploadThumbnail: async (
    artifactId: string,
    blob: Blob,
  ): Promise<UploadArtifactThumbnailResponse> => {
    const res = await fetch(
      resolveApiUrl(`/api/artifacts/${artifactId}/thumbnail`),
      {
        method: "POST",
        headers: { "Content-Type": "image/png", ...authHeaders() },
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
};
