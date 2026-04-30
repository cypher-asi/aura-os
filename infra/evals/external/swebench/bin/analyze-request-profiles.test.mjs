import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("phase1 analyzer reports request contract verdicts when debug fixtures include them", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "phase1-contract-"));
  try {
    const debugLog = path.join(dir, "debug.jsonl");
    const outDir = path.join(dir, "out");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "driver-summary.json"), JSON.stringify({}), "utf8");
    const records = [
      {
        timestamp: 1000,
        hypothesisId: "H_MODEL_CONTENT_PROFILE",
        message: "request contract verdict",
        data: {
          verdict: "Accept",
          requestKind: "DevLoopBootstrap",
          contentSignature: "sig-ok",
          body_hash: "body-ok",
          reasons: [],
        },
      },
      {
        timestamp: 1100,
        hypothesisId: "H_postresp",
        data: {
          model: "claude-test",
          status_code: 200,
          content_type: "text/event-stream",
          body_hash: "body-ok",
          system_bytes: 9000,
          messages_text_bytes: 1200,
          last_user_text_bytes: 300,
          tools_count: 15,
          aura_agent_id_first8: "agent123",
          aura_org_id_first8: "org12345",
          aura_project_id_first8: "proj1234",
          aura_session_id_first8: "sess1234",
        },
      },
    ];
    await fs.writeFile(debugLog, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");

    await execFileAsync(process.execPath, [
      path.resolve("infra/evals/external/swebench/bin/analyze-request-profiles.mjs"),
      "--out",
      outDir,
      "--debug-log",
      debugLog,
      "--driver-summary",
      path.join(outDir, "driver-summary.json"),
    ]);

    const summary = JSON.parse(
      await fs.readFile(path.join(outDir, "phase1-request-profile-analysis.json"), "utf8"),
    );
    const markdown = await fs.readFile(
      path.join(outDir, "phase1-request-profile-analysis.md"),
      "utf8",
    );

    assert.equal(summary.request_contract.available, true);
    assert.equal(summary.request_contract.acceptance, "pass");
    assert.deepEqual(summary.request_contract.verdict_counts, { accept: 1 });
    assert.equal(summary.profiles[0].request_contract.request_kind, "DevLoopBootstrap");
    assert.match(markdown, /request contract verdicts: pass \(accept=1\)/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
