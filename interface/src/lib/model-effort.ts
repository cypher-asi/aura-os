import {
  getModelEfforts,
  loadPersistedModelEffort,
  type ModelEffort,
} from "../constants/models";

export function supportedReasoningEffort(
  modelId?: string | null,
  effort?: ModelEffort | string | null,
): ModelEffort | undefined {
  if (!effort) return undefined;
  const supported = getModelEfforts(modelId);
  return supported.includes(effort as ModelEffort)
    ? (effort as ModelEffort)
    : undefined;
}

export function persistedReasoningEffort(
  modelId?: string | null,
): ModelEffort | undefined {
  return supportedReasoningEffort(modelId, loadPersistedModelEffort(modelId));
}
