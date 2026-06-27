import type {
  AgentLearningReviewResult,
  AgentImprovementProposal,
  AgentImprovementStatus,
  AgentSelfImprovementConfig,
  ProposeAgentImprovementRequest,
} from "../types";
import { apiFetch } from "./core";

const agentPath = (agentId: string, suffix: string) =>
  `/api/agents/${encodeURIComponent(agentId)}${suffix}`;

export const agentImprovementsApi = {
  getConfig: (agentId: string) =>
    apiFetch<AgentSelfImprovementConfig>(
      agentPath(agentId, "/self-improvement"),
    ),
  updateConfig: (
    agentId: string,
    config: AgentSelfImprovementConfig,
  ) =>
    apiFetch<AgentSelfImprovementConfig>(
      agentPath(agentId, "/self-improvement"),
      { method: "PUT", body: JSON.stringify(config) },
    ),
  list: (agentId: string, status?: AgentImprovementStatus) => {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return apiFetch<AgentImprovementProposal[]>(
      agentPath(agentId, `/improvements${query}`),
    );
  },
  propose: (agentId: string, data: ProposeAgentImprovementRequest) =>
    apiFetch<AgentImprovementProposal>(
      agentPath(agentId, "/improvements/propose"),
      { method: "POST", body: JSON.stringify(data) },
    ),
  review: (agentId: string, limitSessions?: number) =>
    apiFetch<AgentLearningReviewResult>(
      agentPath(agentId, "/improvements/review"),
      {
        method: "POST",
        body: JSON.stringify(
          limitSessions ? { limit_sessions: limitSessions } : {},
        ),
      },
    ),
  apply: (agentId: string, proposalId: string) =>
    apiFetch<AgentImprovementProposal>(
      agentPath(
        agentId,
        `/improvements/${encodeURIComponent(proposalId)}/apply`,
      ),
      { method: "POST" },
    ),
  reject: (agentId: string, proposalId: string) =>
    apiFetch<AgentImprovementProposal>(
      agentPath(
        agentId,
        `/improvements/${encodeURIComponent(proposalId)}/reject`,
      ),
      { method: "POST" },
    ),
};
