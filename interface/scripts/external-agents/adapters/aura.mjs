import { promises as fs } from "node:fs";
import path from "node:path";
import {
  openHarnessSession,
  runHarnessTurn,
  waitForHarnessSessionReady,
} from "../../lib/harness-session-runner.mjs";
import {
  buildExternalBenchmarkResult,
  runValidation,
  writeWorkspaceDiffArtifacts,
} from "../lib/external-agent-utils.mjs";

export async function runAuraAdapter(context) {
  const {
    scenario,
    workspaceDir,
    resultsDir,
    runId,
    fixtureDir,
  } = context;

  const harnessBaseUrl = process.env.AURA_EVAL_HARNESS_URL?.trim() || "http://127.0.0.1:3404";
  const harnessWsUrl = `${harnessBaseUrl.replace(/^http/, "ws")}/stream`;
  const accessToken = process.env.AURA_EVAL_ACCESS_TOKEN?.trim() || "";
  const maxTokens = Number(process.env.AURA_EVAL_MAX_TOKENS ?? 2048);
  const transcriptPath = path.join(resultsDir, `${runId}.aura-transcript.json`);

  const session = await openHarnessSession(harnessWsUrl);
  try {
    await waitForHarnessSessionReady(session, {
      workspacePath: workspaceDir,
      accessToken,
      maxTokens,
      maxTurns: 6,
    });
    const turn = await runHarnessTurn(session, scenario.prompt, 1);
    await fs.writeFile(transcriptPath, JSON.stringify(turn, null, 2), "utf8");

    const validation = await runValidation(workspaceDir, scenario);
    const workspaceArtifacts = await writeWorkspaceDiffArtifacts(
      resultsDir,
      runId,
      fixtureDir,
      workspaceDir,
    );

    const usage = turn.usage
      ? {
        ...turn.usage,
        estimatedCostUsd: turn.estimatedCostUsd ?? null,
      }
      : null;

    return buildExternalBenchmarkResult({
      adapterId: "aura",
      scenario,
      command: {
        type: "harness-ws",
        target: harnessBaseUrl,
      },
      processResult: {
        exitCode: turn.stopReason?.includes("error") ? 1 : 0,
        signal: null,
        timedOut: false,
        wallClockMs: turn.wallClockMs ?? 0,
        stdout: turn.text,
        stderr: "",
      },
      validation,
      workspaceArtifacts,
      transcriptPath,
      workspaceDir,
      usage,
      provider: turn.usage?.provider ?? null,
      model: turn.usage?.model ?? null,
      extra: {
        turn,
      },
    });
  } finally {
    session.socket.close();
  }
}
