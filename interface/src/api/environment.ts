import type { EnvironmentInfo } from "../types";
import { apiFetch } from "./core";

export const environmentApi = {
  getEnvironmentInfo: () => apiFetch<EnvironmentInfo>("/api/system/info"),
};
