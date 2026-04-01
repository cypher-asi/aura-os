const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

export interface CreateCronJobRequest {
  name: string;
  description?: string;
  schedule: string;
  prompt: string;
  input_artifact_refs?: import("../types").ArtifactRef[];
  max_retries?: number;
  timeout_seconds?: number;
}

export interface UpdateCronJobRequest {
  name?: string;
  description?: string;
  schedule?: string;
  prompt?: string;
  enabled?: boolean;
  input_artifact_refs?: import("../types").ArtifactRef[];
  max_retries?: number;
  timeout_seconds?: number;
}

export const cronApi = {
  listJobs: () => request<import("../types").CronJob[]>("/cron-jobs"),
  getJob: (id: string) => request<import("../types").CronJob>(`/cron-jobs/${id}`),
  createJob: (data: CreateCronJobRequest) =>
    request<import("../types").CronJob>("/cron-jobs", { method: "POST", body: JSON.stringify(data) }),
  updateJob: (id: string, data: UpdateCronJobRequest) =>
    request<import("../types").CronJob>(`/cron-jobs/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteJob: (id: string) =>
    request<void>(`/cron-jobs/${id}`, { method: "DELETE" }),
  pauseJob: (id: string) =>
    request<import("../types").CronJob>(`/cron-jobs/${id}/pause`, { method: "POST" }),
  resumeJob: (id: string) =>
    request<import("../types").CronJob>(`/cron-jobs/${id}/resume`, { method: "POST" }),
  triggerJob: (id: string) =>
    request<import("../types").CronJobRun>(`/cron-jobs/${id}/trigger`, { method: "POST" }),
  listRuns: (id: string) =>
    request<import("../types").CronJobRun[]>(`/cron-jobs/${id}/runs`),
  getRun: (id: string, runId: string) =>
    request<import("../types").CronJobRun>(`/cron-jobs/${id}/runs/${runId}`),
  listArtifacts: (id: string) =>
    request<import("../types").CronArtifact[]>(`/cron-jobs/${id}/artifacts`),
  getArtifact: (id: string) =>
    request<import("../types").CronArtifact>(`/artifacts/${id}`),
};
