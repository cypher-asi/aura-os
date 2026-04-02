import { promises as fs } from "node:fs";
import path from "node:path";

const interfaceRoot = process.cwd();
const resultsDir = path.resolve(interfaceRoot, process.argv[2] ?? "test-results");

function formatMetric(value) {
  if (value == null) return "n/a";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  return String(value);
}

async function main() {
  const entries = await fs.readdir(resultsDir);
  const benchmarks = [];
  for (const entry of entries) {
    if (!entry.endsWith(".external-benchmark.json")) continue;
    const payload = JSON.parse(await fs.readFile(path.join(resultsDir, entry), "utf8"));
    benchmarks.push(payload);
  }

  const summary = benchmarks
    .sort((a, b) => `${a.scenarioId}:${a.adapter}`.localeCompare(`${b.scenarioId}:${b.adapter}`))
    .map((item) => ({
      scenarioId: item.scenarioId,
      adapter: item.adapter,
      success: item.success,
      qualityPass: item.qualityPass,
      runWallClockMs: item.metrics?.runWallClockMs ?? null,
      estimatedCostUsd: item.metrics?.estimatedCostUsd ?? null,
      inputTokens: item.metrics?.totalInputTokens ?? null,
      outputTokens: item.metrics?.totalOutputTokens ?? null,
      provider: item.usage?.provider ?? null,
      model: item.usage?.model ?? null,
      source: item.artifacts?.transcriptPath ?? null,
    }));

  const outputJson = path.join(resultsDir, "external-agent-benchmark-summary.json");
  const outputMarkdown = path.join(resultsDir, "external-agent-benchmark-summary.md");
  await fs.writeFile(outputJson, JSON.stringify(summary, null, 2), "utf8");

  const lines = [
    "# External Agent Benchmark Summary",
    "",
    "| Scenario | Adapter | Success | Quality | Runtime (ms) | Cost (USD) | Input | Output | Provider | Model |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];

  for (const item of summary) {
    lines.push(
      `| ${item.scenarioId} | ${item.adapter} | ${item.success ? "yes" : "no"} | ${item.qualityPass ? "pass" : "fail"} | ${formatMetric(item.runWallClockMs)} | ${formatMetric(item.estimatedCostUsd)} | ${formatMetric(item.inputTokens)} | ${formatMetric(item.outputTokens)} | ${formatMetric(item.provider)} | ${formatMetric(item.model)} |`,
    );
  }

  await fs.writeFile(outputMarkdown, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`${outputJson}\n${outputMarkdown}\n`);
}

await main();
