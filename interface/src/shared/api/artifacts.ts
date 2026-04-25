import { apiFetch } from "./core";

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
};
