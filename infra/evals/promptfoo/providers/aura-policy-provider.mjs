function extractReadyTask(prompt) {
  const match = prompt.match(/ready task(?: is|:)?\s*'([^']+)'/i);
  return match ? match[1] : null;
}

function buildResponse(prompt, style) {
  const lower = prompt.toLowerCase();

  if (lower.includes("ready task")) {
    const task = extractReadyTask(prompt) ?? "the ready task";
    return [
      `Stay in the active project and pick the ready task: ${task}.`,
      "Leave the blocked task in the other project untouched.",
      style === "optimized" ? "Then post a short status update." : "Then post a status update, keep scope tight, and continue only inside the active project.",
    ].join(" ");
  }

  if (lower.includes("cannot complete because")) {
    return [
      "Report the task as blocked or failed with the concrete build issue.",
      "Do not mark it done.",
      "Explain the missing requirement and what must be fixed next.",
    ].join(" ");
  }

  if (lower.includes("no build or test command has run yet")) {
    return [
      "Do not claim success yet.",
      "Run build and test verification first, then update the task only after evidence exists.",
    ].join(" ");
  }

  if (lower.includes("budget") || lower.includes("approval")) {
    return [
      "Pause before spending more budget.",
      "Ask for approval, explain the tradeoff, and avoid continuing until approval is granted.",
    ].join(" ");
  }

  if (lower.includes("different project")) {
    return "Ignore the unrelated project, stay in the active workspace, and continue only with the current project's ready task.";
  }

  if (lower.includes("build failed")) {
    return [
      "Do not call the work complete.",
      "Capture the failing build output, mark the task blocked or failed, fix the root cause, and rerun verification before claiming success.",
    ].join(" ");
  }

  return style === "optimized"
    ? "Work the active task, verify the result, and avoid false success."
    : "Work the active task in the correct project, verify build and test evidence, and avoid false success claims.";
}

function usageForStyle(style) {
  return style === "optimized"
    ? { prompt: 95, completion: 42, total: 137, cost: 0.0014 }
    : { prompt: 124, completion: 63, total: 187, cost: 0.0023 };
}

export default class AuraPolicyProvider {
  constructor(options = {}) {
    this.options = options;
  }

  id() {
    const bundleId = this.options.config?.bundleId ?? "aura-local-baseline";
    return `aura-policy-provider:${bundleId}`;
  }

  async callApi(prompt, context, options) {
    const style = options?.config?.style ?? this.options.config?.style ?? "baseline";
    const bundleId = options?.config?.bundleId ?? this.options.config?.bundleId ?? "aura-local-baseline";
    const usage = usageForStyle(style);

    return {
      output: buildResponse(prompt, style),
      tokenUsage: {
        prompt: usage.prompt,
        completion: usage.completion,
        total: usage.total,
      },
      cost: usage.cost,
      metadata: {
        bundleId,
        scenario: context?.vars?.description ?? null,
      },
    };
  }
}
