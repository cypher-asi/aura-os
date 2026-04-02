import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildExternalBenchmarkResult,
  runProcess,
  runValidation,
  writeWorkspaceDiffArtifacts,
} from "../lib/external-agent-utils.mjs";

export async function runClaudeCodeAdapter(context) {
  const {
    scenario,
    workspaceDir,
    resultsDir,
    runId,
    fixtureDir,
  } = context;

  const transcriptPath = path.join(resultsDir, `${runId}.claude-code.jsonl`);
  const model = process.env.AURA_EXT_AGENT_CLAUDE_MODEL?.trim() || "";
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--add-dir",
    workspaceDir,
  ];

  if (model) {
    args.push("--model", model);
  }

  args.push("-");

  const processResult = await runProcess("claude", args, {
    cwd: workspaceDir,
    stdinText: `${scenario.prompt}\n`,
    timeoutMs: Number(process.env.AURA_EXT_AGENT_TIMEOUT_MS ?? 12 * 60 * 1000),
  });

  await fs.writeFile(transcriptPath, processResult.stdout, "utf8");

  const validation = await runValidation(workspaceDir, scenario);
  const workspaceArtifacts = await writeWorkspaceDiffArtifacts(
    resultsDir,
    runId,
    fixtureDir,
    workspaceDir,
  );

  return buildExternalBenchmarkResult({
    adapterId: "claude-code",
    scenario,
    command: {
      bin: "claude",
      args,
    },
    processResult,
    validation,
    workspaceArtifacts,
    transcriptPath,
    workspaceDir,
    usage: null,
    provider: "anthropic",
    model: model || null,
  });
}
