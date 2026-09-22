import { apiFetch } from "./core";
import type {
  ToolApprovalDecision,
  ToolApprovalRemember,
} from "../types/harness-protocol";

/** Kind of harness flow a resumable stream represents. Mirrors the
 *  server `StreamKind` enum. */
export type StreamKind =
  | "spec_gen"
  | "spec_summary"
  | "chat_turn"
  | "image_gen"
  | "video_gen"
  | "mesh3d_gen";

export interface StreamScope {
  user_id?: string | null;
  project_id?: string | null;
  agent_instance_id?: string | null;
  session_id?: string | null;
}

/** One reattachable stream from `GET /api/streams/active`. */
export interface ActiveStreamSummary {
  attach_id: string;
  kind: StreamKind;
  scope: StreamScope;
  latest_seq: number;
  terminated: boolean;
  started_at_ms: number;
}

export interface ActiveStreamsResponse {
  streams: ActiveStreamSummary[];
}

export interface ActiveStreamsFilter {
  project_id?: string;
  agent_instance_id?: string;
}

export const streamsApi = {
  /**
   * List harness streams the caller can reattach to (spec gen, chat
   * turns, media generation). Used on WS (re)connect / app boot to
   * rediscover work that is still in flight after a disconnect.
   */
  listActiveStreams: (filter?: ActiveStreamsFilter) => {
    const params = new URLSearchParams();
    if (filter?.project_id) params.set("project_id", filter.project_id);
    if (filter?.agent_instance_id)
      params.set("agent_instance_id", filter.agent_instance_id);
    const qs = params.toString();
    return apiFetch<ActiveStreamsResponse>(
      `/api/streams/active${qs ? `?${qs}` : ""}`,
    );
  },

  /** Request cancellation of a running stream's underlying harness run. */
  cancelStream: (attachId: string) =>
    apiFetch<{ cancelled: boolean }>(
      `/api/streams/${encodeURIComponent(attachId)}/cancel`,
      { method: "POST" },
    ),

  /** Answer a protected tool request on the environment-owned live run. */
  respondToToolApproval: (
    requestId: string,
    decision: ToolApprovalDecision,
    remember: ToolApprovalRemember,
  ) =>
    apiFetch<{ accepted: boolean }>(
      `/api/streams/tool-approvals/${encodeURIComponent(requestId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, remember }),
      },
    ),
};
