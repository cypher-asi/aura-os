import { apiFetch } from "./core";

export interface CreateCronJobRequest {
  name: string;
  description?: string;
  schedule: string;
  prompt?: string;
  tag?: string;
  input_artifact_refs?: import("../types").ArtifactRef[];
  max_retries?: number;
  timeout_seconds?: number;
}

export interface UpdateCronJobRequest {
  name?: string;
  description?: string;
  schedule?: string;
  prompt?: string;
  tag?: string;
  enabled?: boolean;
  input_artifact_refs?: import("../types").ArtifactRef[];
  max_retries?: number;
  timeout_seconds?: number;
}

export const cronApi = {
  listJobs: () => apiFetch<import("../types").CronJob[]>("/cron-jobs"),
  getJob: (id: string) => apiFetch<import("../types").CronJob>(`/cron-jobs/${id}`),
  createJob: (data: CreateCronJobRequest) =>
    apiFetch<import("../types").CronJob>("/cron-jobs", { method: "POST", body: JSON.stringify(data) }),
  updateJob: (id: string, data: UpdateCronJobRequest) =>
    apiFetch<import("../types").CronJob>(`/cron-jobs/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteJob: (id: string) =>
    apiFetch<void>(`/cron-jobs/${id}`, { method: "DELETE" }),
  pauseJob: (id: string) =>
    apiFetch<import("../types").CronJob>(`/cron-jobs/${id}/pause`, { method: "POST" }),
  resumeJob: (id: string) =>
    apiFetch<import("../types").CronJob>(`/cron-jobs/${id}/resume`, { method: "POST" }),
  triggerJob: (id: string) =>
    apiFetch<import("../types").CronJobRun>(`/cron-jobs/${id}/trigger`, { method: "POST" }),
  listRuns: (id: string) =>
    apiFetch<import("../types").CronJobRun[]>(`/cron-jobs/${id}/runs`),
  getRun: (id: string, runId: string) =>
    apiFetch<import("../types").CronJobRun>(`/cron-jobs/${id}/runs/${runId}`),
  listArtifacts: (id: string) =>
    apiFetch<import("../types").CronArtifact[]>(`/cron-jobs/${id}/artifacts`),
  getArtifact: (id: string) =>
    apiFetch<import("../types").CronArtifact>(`/artifacts/${id}`),

  listTags: () => apiFetch<import("../types").CronTag[]>("/cron-tags"),
  createTag: (name: string) =>
    apiFetch<import("../types").CronTag>("/cron-tags", { method: "POST", body: JSON.stringify({ name }) }),
  deleteTag: (tagId: string) =>
    apiFetch<void>(`/cron-tags/${tagId}`, { method: "DELETE" }),
};
