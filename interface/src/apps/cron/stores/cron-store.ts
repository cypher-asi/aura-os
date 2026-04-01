import { create } from "zustand";
import type { CronJob, CronJobRun, CronArtifact } from "../../../types";
import { cronApi } from "../../../api/cron";

interface CronState {
  jobs: CronJob[];
  loading: boolean;
  runs: Record<string, CronJobRun[]>;
  artifacts: Record<string, CronArtifact[]>;
  fetchJobs: () => Promise<void>;
  fetchRuns: (cronJobId: string) => Promise<void>;
  fetchArtifacts: (cronJobId: string) => Promise<void>;
  addJob: (job: CronJob) => void;
  updateJob: (job: CronJob) => void;
  removeJob: (cronJobId: string) => void;
}

export const useCronStore = create<CronState>()((set) => ({
  jobs: [],
  loading: false,
  runs: {},
  artifacts: {},

  fetchJobs: async () => {
    set({ loading: true });
    try {
      const jobs = await cronApi.listJobs();
      set({ jobs, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchRuns: async (cronJobId: string) => {
    try {
      const runs = await cronApi.listRuns(cronJobId);
      set((s) => ({ runs: { ...s.runs, [cronJobId]: runs } }));
    } catch { /* ignore */ }
  },

  fetchArtifacts: async (cronJobId: string) => {
    try {
      const artifacts = await cronApi.listArtifacts(cronJobId);
      set((s) => ({ artifacts: { ...s.artifacts, [cronJobId]: artifacts } }));
    } catch { /* ignore */ }
  },

  addJob: (job) => set((s) => ({ jobs: [job, ...s.jobs] })),
  updateJob: (job) => set((s) => ({
    jobs: s.jobs.map((j) => j.cron_job_id === job.cron_job_id ? job : j),
  })),
  removeJob: (cronJobId) => set((s) => ({
    jobs: s.jobs.filter((j) => j.cron_job_id !== cronJobId),
  })),
}));
