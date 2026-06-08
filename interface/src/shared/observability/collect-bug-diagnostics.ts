import { getBuildInfo } from "../../lib/build-info";
import {
  getRecent,
  getRecentForStream,
  type StreamBreadcrumb,
} from "../../stores/stream-breadcrumbs-store";
import { getStreamEntry } from "../../hooks/stream/store";
import { useChatUIStore } from "../../stores/chat-ui-store";
import { useAgentStore } from "../../apps/agents/stores/agent-store";
import { useProfileStatusStore } from "../../stores/profile-status-store";
import { useOrgStore } from "../../stores/org-store";
import { useAuthStore } from "../../stores/auth-store";
import { inferNativePlatform, isNativeRuntime } from "../lib/native-runtime";
import { detectClientPlatform, formatClientDevice } from "../lib/device-info";
import { resolveAvatarState } from "../../hooks/use-avatar-state";
import type { DisplaySessionEvent } from "../types/stream";

/**
 * Per-turn entry in the captured transcript. Only the role and the
 * plain-text body are kept — tool inputs, image data, and other
 * binary blocks are intentionally dropped so the bundle stays small
 * and free of attachment contents (file names are out of scope for
 * the client capture today).
 */
export interface BugTranscriptTurn {
  role: "user" | "assistant" | "system";
  text: string;
}

/**
 * Context the calling surface already knows (the chat error bubble /
 * stuck-stream pill render `ReportBugButton` with these). Everything
 * else the collector pulls from the relevant global store at submit
 * time. All fields optional so callers without a pinned agent /
 * session still produce a useful bundle.
 */
export interface BugDiagnosticsInput {
  streamKey?: string;
  supportId?: string;
  agentId?: string;
  sessionId?: string;
}

export interface BugDiagnostics {
  capturedAt: string;
  build: {
    version: string;
    commit: string;
    buildTime: string;
    channel: string;
    isDev: boolean;
  };
  context: {
    streamKey: string | null;
    supportId: string | null;
    sessionId: string | null;
    projectId: string | null;
    orgId: string | null;
    agentId: string | null;
    agentName: string | null;
    agentRole: string | null;
    /** "local" / "remote" when known. */
    agentMachineType: string | null;
    /** Normalized agent status (idle / running / error / ...). */
    agentStatus: string | null;
    /** Device the user is currently running the app on. */
    clientDevice: string;
    model: string | null;
    reasoningEffort: string | null;
    mode: string | null;
    prompt: string | null;
    transcript: BugTranscriptTurn[];
    errorMessage: string | null;
    errorSupportId: string | null;
  };
  breadcrumbs: StreamBreadcrumb[];
  machine: {
    platform: "desktop" | "mobile" | "web";
    nativePlatform: "android" | "ios" | null;
    isNativeRuntime: boolean;
    userAgent: string | null;
    osPlatform: string | null;
    language: string | null;
    screenWidth: number | null;
    screenHeight: number | null;
    timeZone: string | null;
    onLine: boolean | null;
  };
  user: {
    userId: string | null;
    networkUserId: string | null;
    displayName: string | null;
    isZeroPro: boolean | null;
  };
}

const MAX_TRANSCRIPT_TURNS = 20;
const MAX_TURN_TEXT_CHARS = 4000;

function clampText(text: string): string {
  if (text.length <= MAX_TURN_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TURN_TEXT_CHARS)}… [truncated ${text.length - MAX_TURN_TEXT_CHARS} chars]`;
}

function extractText(event: DisplaySessionEvent): string {
  if (typeof event.content === "string" && event.content.trim().length > 0) {
    return event.content;
  }
  const blocks = event.contentBlocks;
  if (Array.isArray(blocks)) {
    const joined = blocks
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (joined.length > 0) return joined;
  }
  return "";
}

function collectTranscript(streamKey: string | undefined): {
  transcript: BugTranscriptTurn[];
  prompt: string | null;
  errorMessage: string | null;
  errorSupportId: string | null;
} {
  const empty = {
    transcript: [] as BugTranscriptTurn[],
    prompt: null as string | null,
    errorMessage: null as string | null,
    errorSupportId: null as string | null,
  };
  if (!streamKey) return empty;
  try {
    const entry = getStreamEntry(streamKey);
    const events = entry?.events ?? [];
    const turns: BugTranscriptTurn[] = events
      .map((event) => ({ role: event.role, text: clampText(extractText(event)) }))
      .filter((turn) => turn.text.length > 0);
    const recent = turns.slice(-MAX_TRANSCRIPT_TURNS);
    const lastUser = [...turns].reverse().find((turn) => turn.role === "user");
    const lastError = [...events]
      .reverse()
      .find((event) => !!event.errorMessage || !!event.supportId);
    return {
      transcript: recent,
      prompt: lastUser?.text ?? null,
      errorMessage: lastError?.errorMessage ?? null,
      errorSupportId: lastError?.supportId ?? null,
    };
  } catch {
    return empty;
  }
}

function collectChatContext(streamKey: string | undefined): {
  model: string | null;
  reasoningEffort: string | null;
  mode: string | null;
  projectId: string | null;
} {
  const fallback = {
    model: null as string | null,
    reasoningEffort: null as string | null,
    mode: null as string | null,
    projectId: null as string | null,
  };
  if (!streamKey) return fallback;
  try {
    const stream = useChatUIStore.getState().streams[streamKey];
    if (!stream) return fallback;
    return {
      model: stream.selectedModel ?? null,
      reasoningEffort: stream.selectedEffort ?? null,
      mode: stream.selectedMode ?? null,
      projectId: stream.projectId ?? null,
    };
  } catch {
    return fallback;
  }
}

function collectAgent(agentId: string | undefined): {
  agentName: string | null;
  agentRole: string | null;
  agentMachineType: string | null;
  agentStatus: string | null;
} {
  const empty = {
    agentName: null,
    agentRole: null,
    agentMachineType: null,
    agentStatus: null,
  };
  if (!agentId) return empty;
  try {
    const agent = useAgentStore
      .getState()
      .agents.find((a) => a.agent_id === agentId);
    const profile = useProfileStatusStore.getState();
    const { status, machineType } = resolveAvatarState(
      profile.statuses[agentId],
      profile.machineTypes[agentId],
    );
    return {
      agentName: agent?.name ?? null,
      agentRole: agent?.role ?? null,
      agentMachineType: machineType,
      agentStatus: status ?? null,
    };
  } catch {
    return empty;
  }
}

function collectOrgId(): string | null {
  try {
    return useOrgStore.getState().activeOrg?.org_id ?? null;
  } catch {
    return null;
  }
}

function collectUser(): BugDiagnostics["user"] {
  try {
    const user = useAuthStore.getState().user;
    return {
      userId: user?.user_id ?? null,
      networkUserId: user?.network_user_id ?? null,
      displayName: user?.display_name ?? null,
      isZeroPro: user?.is_zero_pro ?? null,
    };
  } catch {
    return {
      userId: null,
      networkUserId: null,
      displayName: null,
      isZeroPro: null,
    };
  }
}

function detectPlatform(): "desktop" | "mobile" | "web" {
  return detectClientPlatform();
}

function collectMachine(): BugDiagnostics["machine"] {
  const machine: BugDiagnostics["machine"] = {
    platform: detectPlatform(),
    nativePlatform: null,
    isNativeRuntime: false,
    userAgent: null,
    osPlatform: null,
    language: null,
    screenWidth: null,
    screenHeight: null,
    timeZone: null,
    onLine: null,
  };
  try {
    machine.nativePlatform = inferNativePlatform();
    machine.isNativeRuntime = isNativeRuntime();
  } catch {
    /* best-effort */
  }
  try {
    if (typeof navigator !== "undefined") {
      machine.userAgent = navigator.userAgent ?? null;
      machine.osPlatform = navigator.platform ?? null;
      machine.language = navigator.language ?? null;
      machine.onLine = typeof navigator.onLine === "boolean" ? navigator.onLine : null;
    }
  } catch {
    /* best-effort */
  }
  try {
    if (typeof screen !== "undefined") {
      machine.screenWidth = screen.width ?? null;
      machine.screenHeight = screen.height ?? null;
    }
  } catch {
    /* best-effort */
  }
  try {
    machine.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    /* best-effort */
  }
  return machine;
}

/**
 * Assemble the full, JSON-serializable diagnostic bundle submitted
 * with a private bug report. Every source is wrapped defensively so a
 * missing store, a non-DOM environment, or an unexpected shape can
 * never throw — a partial bundle is always better than blocking the
 * user's report. Deliberately omits secrets: no access tokens, JWTs,
 * or wallet material are ever read here (only the auth store's public
 * profile fields).
 */
export function collectBugDiagnostics(
  input: BugDiagnosticsInput = {},
): BugDiagnostics {
  const { streamKey, supportId, agentId, sessionId } = input;

  let build: BugDiagnostics["build"];
  try {
    const info = getBuildInfo();
    build = {
      version: info.version,
      commit: info.commit,
      buildTime: info.buildTime,
      channel: String(info.channel),
      isDev: info.isDev,
    };
  } catch {
    build = {
      version: "unknown",
      commit: "unknown",
      buildTime: "unknown",
      channel: "unknown",
      isDev: false,
    };
  }

  let breadcrumbs: StreamBreadcrumb[] = [];
  try {
    breadcrumbs = streamKey ? getRecentForStream(streamKey, 20) : getRecent(20);
  } catch {
    breadcrumbs = [];
  }

  const transcript = collectTranscript(streamKey);
  const chat = collectChatContext(streamKey);
  const agent = collectAgent(agentId);

  return {
    capturedAt: new Date().toISOString(),
    build,
    context: {
      streamKey: streamKey ?? null,
      supportId: supportId ?? transcript.errorSupportId ?? null,
      sessionId: sessionId ?? null,
      projectId: chat.projectId,
      orgId: collectOrgId(),
      agentId: agentId ?? null,
      agentName: agent.agentName,
      agentRole: agent.agentRole,
      agentMachineType: agent.agentMachineType,
      agentStatus: agent.agentStatus,
      clientDevice: formatClientDevice(),
      model: chat.model,
      reasoningEffort: chat.reasoningEffort,
      mode: chat.mode,
      prompt: transcript.prompt,
      transcript: transcript.transcript,
      errorMessage: transcript.errorMessage,
      errorSupportId: transcript.errorSupportId,
    },
    breadcrumbs,
    machine: collectMachine(),
    user: collectUser(),
  };
}
