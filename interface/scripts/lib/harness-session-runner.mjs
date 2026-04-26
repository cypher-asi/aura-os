import { calculateEstimatedCostUsd } from "./benchmark-pricing.mjs";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readNumber(record, keys) {
  for (const key of keys) {
    if (typeof record[key] === "number" && Number.isFinite(record[key])) {
      return record[key];
    }
  }
  return null;
}

export function readHarnessUsage(message) {
  const usage = asRecord(message.usage);
  if (!usage) return null;
  const inputTokens = Number(readNumber(usage, ["input_tokens", "inputTokens", "prompt_tokens"]) ?? 0);
  const outputTokens = Number(
    readNumber(usage, ["output_tokens", "outputTokens", "completion_tokens"]) ?? 0,
  );
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: Number(
      readNumber(usage, [
        "cache_creation_input_tokens",
        "cacheCreationInputTokens",
        "prompt_cache_miss_tokens",
      ]) ?? 0,
    ),
    cacheReadInputTokens: Number(
      readNumber(usage, [
        "cache_read_input_tokens",
        "cacheReadInputTokens",
        "prompt_cache_hit_tokens",
      ]) ?? 0,
    ),
    estimatedContextTokens: Number(usage.estimated_context_tokens ?? 0),
    contextUtilization: Number(usage.context_utilization ?? 0),
    model: typeof usage.model === "string" ? usage.model : null,
    provider: typeof usage.provider === "string" ? usage.provider : null,
  };
}

export function countHarnessFilesChanged(message) {
  const filesChanged = asRecord(message.files_changed);
  if (!filesChanged) return 0;
  return ["created", "modified", "deleted"].reduce((count, key) => {
    const value = filesChanged[key];
    return count + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

function toJsonMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

export function openHarnessSession(harnessWsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(harnessWsUrl);
    const state = {
      socket,
      sessionReady: false,
    };

    socket.addEventListener("open", () => resolve(state));
    socket.addEventListener("error", (event) => {
      reject(event.error ?? new Error("WebSocket error"));
    });
  });
}

export async function waitForHarnessSessionReady(state, options) {
  const {
    workspacePath,
    accessToken = "",
    maxTurns = 16,
    maxTokens = 2048,
  } = options;

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "session_ready") {
        state.sessionReady = true;
        state.socket.removeEventListener("message", onMessage);
        resolve({
          ...message,
          sessionInitMs: Date.now() - startedAt,
        });
      } else if (message.type === "error") {
        state.socket.removeEventListener("message", onMessage);
        reject(new Error(message.message ?? "session init failed"));
      }
    };

    state.socket.addEventListener("message", onMessage);
    state.socket.send(toJsonMessage("session_init", {
      project_path: workspacePath,
      max_turns: maxTurns,
      max_tokens: Number.isFinite(maxTokens) ? maxTokens : 2048,
      token: accessToken || undefined,
    }));
  });
}

export async function runHarnessTurn(state, prompt, turnIndex = 1) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const turn = {
      turnIndex,
      prompt,
      text: "",
      toolNames: [],
      toolResults: [],
      usage: null,
      fileChangeCount: 0,
      rawEnd: null,
      firstEventAt: null,
      completedAt: null,
      wallClockMs: null,
      timeToFirstEventMs: null,
      stopReason: null,
      estimatedCostUsd: 0,
      pricing: null,
    };

    const markFirstEvent = () => {
      if (turn.firstEventAt == null) {
        turn.firstEventAt = Date.now();
        turn.timeToFirstEventMs = turn.firstEventAt - startedAt;
      }
    };

    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      switch (message.type) {
        case "text_delta":
          markFirstEvent();
          turn.text += message.text ?? "";
          break;
        case "thinking_delta":
          markFirstEvent();
          break;
        case "tool_use_start":
          markFirstEvent();
          if (typeof message.name === "string") {
            turn.toolNames.push(message.name);
          }
          break;
        case "tool_result":
          markFirstEvent();
          turn.toolResults.push({
            name: typeof message.name === "string" ? message.name : "unknown",
            isError: Boolean(message.is_error),
            resultPreview:
              typeof message.result === "string"
                ? message.result.slice(0, 240)
                : "",
          });
          break;
        case "assistant_message_end":
          markFirstEvent();
          turn.rawEnd = message;
          turn.usage = readHarnessUsage(message);
          turn.fileChangeCount = countHarnessFilesChanged(message);
          turn.stopReason = typeof message.stop_reason === "string" ? message.stop_reason : null;
          turn.completedAt = Date.now();
          turn.wallClockMs = turn.completedAt - startedAt;
          if (turn.usage) {
            const { estimatedCostUsd, pricing } = calculateEstimatedCostUsd(turn.usage);
            turn.estimatedCostUsd = estimatedCostUsd;
            turn.pricing = pricing;
          }
          state.socket.removeEventListener("message", onMessage);
          resolve(turn);
          break;
        case "error":
          state.socket.removeEventListener("message", onMessage);
          reject(new Error(message.message ?? "turn failed"));
          break;
        default:
          break;
      }
    };

    state.socket.addEventListener("message", onMessage);
    state.socket.send(toJsonMessage("user_message", {
      content: prompt,
    }));
  });
}
