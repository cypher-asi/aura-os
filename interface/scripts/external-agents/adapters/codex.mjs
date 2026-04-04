import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildExternalBenchmarkResult,
  runProcess,
  runValidation,
  writeWorkspaceDiffArtifacts,
} from "../lib/external-agent-utils.mjs";
import { extractCodexUsageFromJsonl } from "../lib/external-agent-usage.mjs";

export async function runCodexAdapter(context) {
  const {
    scenario,
    workspaceDir,
    resultsDir,
    runId,
    fixtureDir,
  } = context;

  const transcriptPath = path.join(resultsDir, `${runId}.codex.jsonl`);
  const model = process.env.AURA_EXT_AGENT_CODEX_MODEL?.trim() || "";
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd",
    workspaceDir,
  ];

  if (model) {
    args.push("--model", model);
  }

  args.push("-");

  const processResult = await runProcess("codex", args, {
    cwd: workspaceDir,
    stdinText: `${scenario.prompt}\n`,
    timeoutMs: Number(process.env.AURA_EXT_AGENT_TIMEOUT_MS ?? 12 * 60 * 1000),
  });

  await fs.writeFile(transcriptPath, processResult.stdout, "utf8");
  const parsed = extractCodexUsageFromJsonl(processResult.stdout, model || null);

  const validation = await runValidation(workspaceDir, scenario);
  const workspaceArtifacts = await writeWorkspaceDiffArtifacts(
    resultsDir,
    runId,
    fixtureDir,
    workspaceDir,
  );

  return buildExternalBenchmarkResult({
    adapterId: "codex",
    scenario,
    command: {
      bin: "codex",
      args,
    },
    processResult,
    validation,
    workspaceArtifacts,
    transcriptPath,
    workspaceDir,
    usage: parsed?.usage ?? null,
    provider: parsed?.provider ?? "openai",
    model: parsed?.model ?? (model || null),
  });
}
