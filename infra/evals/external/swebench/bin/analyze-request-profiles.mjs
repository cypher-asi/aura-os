#!/usr/bin/env node
// Phase 1 diagnostic: compare successful and blocked LLM request profiles
// recorded by the harness debug stream. This intentionally consumes only
// structured, already-sanitized fields (sizes, hashes, headers-present labels)
// so it can run after benchmark failures without dumping prompt content.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  describeRequestContractSummary,
  extractRequestContractReports,
  summarizeRequestContractReports,
} from "../lib/request-contract-reporting.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..", "..", "..");
const DEFAULT_LOOKBACK_MS = 10 * 60 * 1000;

function parseArgs(argv) {
  const args = {
    outDir: "",
    debugLog: process.env.AURA_PHASE1_DEBUG_LOG?.trim()
      || path.join(repoRoot, "debug-95fd5c.log"),
    driverSummary: "",
    lookbackMs: Number(process.env.AURA_PHASE1_LOOKBACK_MS ?? DEFAULT_LOOKBACK_MS),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) {
      args.outDir = argv[++i];
    } else if (arg.startsWith("--out=")) {
      args.outDir = arg.slice("--out=".length);
    } else if (arg === "--debug-log" && argv[i + 1]) {
      args.debugLog = argv[++i];
    } else if (arg.startsWith("--debug-log=")) {
      args.debugLog = arg.slice("--debug-log=".length);
    } else if (arg === "--driver-summary" && argv[i + 1]) {
      args.driverSummary = argv[++i];
    } else if (arg.startsWith("--driver-summary=")) {
      args.driverSummary = arg.slice("--driver-summary=".length);
    } else if (arg === "--lookback-ms" && argv[i + 1]) {
      args.lookbackMs = Number(argv[++i]);
    } else if (arg.startsWith("--lookback-ms=")) {
      args.lookbackMs = Number(arg.slice("--lookback-ms=".length));
    }
  }
  if (!args.outDir) {
    throw new Error("--out is required");
  }
  if (!args.driverSummary) {
    args.driverSummary = path.join(args.outDir, "driver-summary.json");
  }
  return args;
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function readDebugRecords(file) {
  const text = await fs.readFile(file, "utf8");
  const records = [];
  for (const [idx, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record && typeof record === "object") {
        record.__line = idx + 1;
        records.push(record);
      }
    } catch {
      // Ignore partial/manual log lines; the debug file is append-only.
    }
  }
  return records.sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));
}

function runWindow(summary, lookbackMs) {
  const started = Date.parse(summary?.started_at ?? "");
  const finished = Date.parse(summary?.finished_at ?? "");
  if (Number.isFinite(started) && Number.isFinite(finished)) {
    return {
      startMs: Math.max(0, started - lookbackMs),
      runStartMs: started,
      endMs: finished + 60_000,
    };
  }
  return { startMs: 0, runStartMs: 0, endMs: Number.MAX_SAFE_INTEGER };
}

function inWindow(record, window) {
  const ts = Number(record.timestamp ?? 0);
  return ts >= window.startMs && ts <= window.endMs;
}

function classifyRoute(data) {
  const toolsCount = Number(data.tools_count ?? 0);
  const systemBytes = Number(data.system_bytes ?? 0);
  if (toolsCount === 15 || systemBytes >= 8_000) return "dev_loop";
  if (toolsCount === 49 && !data.aura_session_id_first8) return "project_tool";
  if (toolsCount === 49) return "chat_or_project_tool";
  if (toolsCount === 0) return "simple_auxiliary";
  return "unknown";
}

function outcomeForStatus(statusCode) {
  if (statusCode === 403) return "blocked_403";
  if (statusCode >= 200 && statusCode < 300) return "success";
  if (statusCode > 0) return `http_${statusCode}`;
  return "unknown";
}

function nearestPrior(records, target, predicate, maxDeltaMs = 10_000) {
  const ts = Number(target.timestamp ?? 0);
  let best = null;
  for (const record of records) {
    const rts = Number(record.timestamp ?? 0);
    if (rts > ts) break;
    if (ts - rts > maxDeltaMs) continue;
    if (!predicate(record)) continue;
    best = record;
  }
  return best;
}

function matchingContractReport(record, data, reports) {
  const bodyHash = data.body_hash ?? "";
  const timestamp = Number(record.timestamp ?? 0);
  const sameBody = reports
    .filter((report) => report.body_hash && report.body_hash === bodyHash)
    .sort((a, b) => Math.abs(timestamp - Number(a.timestamp ?? 0)) - Math.abs(timestamp - Number(b.timestamp ?? 0)))[0];
  if (sameBody) return sameBody;
  return reports
    .filter((report) => {
      const rts = Number(report.timestamp ?? 0);
      return rts > 0 && rts <= timestamp && timestamp - rts <= 10_000;
    })
    .sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0))[0] ?? null;
}

function normalizeProfile(record, allRecords, contractReports = []) {
  const data = record.data ?? {};
  const wire = nearestPrior(
    allRecords,
    record,
    (candidate) => candidate.hypothesisId === "H1-H5-harness-wire"
      && candidate.data?.model === data.model,
  );
  const cap = nearestPrior(
    allRecords,
    record,
    (candidate) => candidate.hypothesisId === "H_BODY_SIZE"
      && candidate.data?.model === data.model,
    4_000,
  );
  const waf = nearestPrior(
    allRecords,
    record,
    (candidate) => candidate.hypothesisId === "H_WAF_UNICODE_ESCAPE"
      && candidate.data?.model === data.model,
    4_000,
  );
  const cf = nearestPrior(
    allRecords,
    record,
    (candidate) => candidate.hypothesisId === "H_CONTENT_PATTERN"
      && candidate.data?.body_hash === data.body_hash,
    4_000,
  );
  const statusCode = Number(data.status_code ?? 0);
  const route = classifyRoute(data);
  const requestContract = matchingContractReport(record, data, contractReports);
  return {
    line: record.__line,
    timestamp: Number(record.timestamp ?? 0),
    route,
    outcome: outcomeForStatus(statusCode),
    model: data.model ?? "",
    status_code: statusCode || null,
    content_type: data.content_type ?? "",
    server_header: data.server_header ?? "",
    cf_ray: data.cf_ray ?? "",
    body_hash: data.body_hash ?? "",
    body_len: wire?.data?.body_len ?? waf?.data?.body_len ?? null,
    response_elapsed_ms: data.elapsed_ms ?? null,
    stream: data.stream ?? null,
    system_bytes: data.system_bytes ?? null,
    messages_text_bytes: data.messages_text_bytes ?? null,
    last_user_text_bytes: data.last_user_text_bytes ?? null,
    last_user_text_hash: data.last_user_text_hash ?? null,
    tools_count: data.tools_count ?? null,
    tool_names: data.tool_names ?? "",
    tool_choice: data.tool_choice ?? "",
    has_thinking: data.has_thinking ?? null,
    has_output_config: data.has_output_config ?? null,
    top_level_keys: data.top_level_keys ?? "",
    aura_agent_present: Boolean(data.aura_agent_id_first8 || wire?.data?.has_aura_agent_id),
    aura_org_present: Boolean(data.aura_org_id_first8 || wire?.data?.has_aura_org_id),
    aura_project_present: Boolean(data.aura_project_id_first8 || wire?.data?.has_aura_project_id),
    aura_session_present: Boolean(data.aura_session_id_first8 || wire?.data?.has_aura_session_id),
    prompt_caching_will_be_added: wire?.data?.prompt_caching_will_be_added ?? null,
    upstream_provider_family: data.upstream_provider_family ?? wire?.data?.upstream_provider_family ?? "",
    body_cap_original_bytes: cap?.data?.original_bytes ?? null,
    body_cap_final_bytes: cap?.data?.final_bytes ?? null,
    body_cap_truncated_ok: cap?.data?.truncated_ok ?? null,
    body_cap_error: cap?.data?.error ?? null,
    waf_safe_enabled: waf?.data?.waf_safe_enabled ?? null,
    waf_escaped_chars: waf?.data?.escaped_chars ?? "",
    cf_response_headers: cf?.data?.cf_response_headers ?? [],
    request_contract: requestContract,
  };
}

function profileSortKey(profile) {
  return `${profile.route}:${profile.timestamp}`;
}

function chooseComparisons(profiles) {
  const failures = profiles.filter((p) => p.outcome === "blocked_403");
  const successes = profiles.filter((p) => p.outcome === "success");
  const comparisons = [];
  for (const failure of failures) {
    const sameRoute = successes
      .filter((s) => s.route === failure.route && s.timestamp < failure.timestamp)
      .sort((a, b) => Math.abs(failure.timestamp - a.timestamp) - Math.abs(failure.timestamp - b.timestamp))[0];
    const anyRoute = successes
      .filter((s) => s.timestamp < failure.timestamp)
      .sort((a, b) => Math.abs(failure.timestamp - a.timestamp) - Math.abs(failure.timestamp - b.timestamp))[0];
    const baseline = sameRoute ?? anyRoute ?? successes[0] ?? null;
    comparisons.push({ failure, baseline });
  }
  return comparisons;
}

const DIFF_FIELDS = [
  "route",
  "model",
  "stream",
  "system_bytes",
  "body_len",
  "messages_text_bytes",
  "last_user_text_bytes",
  "tools_count",
  "top_level_keys",
  "tool_choice",
  "has_thinking",
  "has_output_config",
  "aura_agent_present",
  "aura_org_present",
  "aura_project_present",
  "aura_session_present",
  "prompt_caching_will_be_added",
  "waf_safe_enabled",
  "body_cap_truncated_ok",
  "body_cap_error",
];

function fieldDiffs(baseline, failure) {
  if (!baseline) return DIFF_FIELDS.map((field) => ({
    field,
    baseline: null,
    failure: failure[field] ?? null,
    same: false,
  }));
  return DIFF_FIELDS.map((field) => ({
    field,
    baseline: baseline[field] ?? null,
    failure: failure[field] ?? null,
    same: JSON.stringify(baseline[field] ?? null) === JSON.stringify(failure[field] ?? null),
  }));
}

function summarizeFindings(profiles, comparisons) {
  const failures = comparisons.map((c) => c.failure);
  const successes = profiles.filter((p) => p.outcome === "success");
  const findings = [];
  const contractSummary = summarizeRequestContractReports(
    profiles.map((profile) => profile.request_contract).filter(Boolean),
  );
  findings.push(describeRequestContractSummary(contractSummary));
  if (failures.length === 0) {
    findings.push("No Cloudflare 403 request profiles were present in the selected debug window.");
    return findings;
  }
  if (successes.length === 0) {
    findings.push("Only failing profiles were present; rerun with phase 0 enabled or increase lookback to compare against passing turns.");
    return findings;
  }
  const devLoopFailures = failures.filter((p) => p.route === "dev_loop");
  const projectToolFailures = failures.filter((p) => p.route === "project_tool");
  const allHaveHeaders = failures.every((p) =>
    p.aura_agent_present && p.aura_org_present && p.aura_project_present && p.aura_session_present
  );
  const allDevLoopHaveHeaders = devLoopFailures.every((p) =>
    p.aura_agent_present && p.aura_org_present && p.aura_project_present && p.aura_session_present
  );
  if (allHaveHeaders) {
    findings.push("All failing profiles carry the full Aura identity envelope; missing X-Aura headers are unlikely to be the differentiator.");
  } else if (devLoopFailures.length > 0 && allDevLoopHaveHeaders && projectToolFailures.length > 0) {
    findings.push("Dev-loop failures carry the full Aura identity envelope; project-tool failures lack session id as that path currently does, so separate project-tool session parity from dev-loop content analysis.");
  } else {
    findings.push("At least one failing profile lacks part of the Aura identity envelope; inspect header propagation before content rules.");
  }

  const routeSet = [...new Set(failures.map((p) => p.route))].join(", ");
  findings.push(`Failing profile route(s): ${routeSet}.`);

  const capFailures = failures.filter((p) => p.body_cap_error || p.body_cap_truncated_ok === false);
  if (capFailures.length > 0) {
    findings.push("Some failing-adjacent profiles show emergency body-cap failure/non-content overhead pressure; compare tool schema and accumulated tool-result overhead.");
  }

  const contentTypes = [...new Set(failures.map((p) => p.content_type).filter(Boolean))].join(", ");
  if (contentTypes) {
    findings.push(`Blocked responses are ${contentTypes}, consistent with Cloudflare HTML rather than model JSON errors.`);
  }
  return findings;
}

function markdownTable(headers, rows) {
  const escapeCell = (value) => String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function renderMarkdown(summary) {
  const profileRows = summary.profiles.map((p) => [
    p.outcome,
    p.route,
    p.status_code ?? "",
    p.model,
    p.body_hash,
    p.body_len ?? "",
    p.system_bytes ?? "",
    p.messages_text_bytes ?? "",
    p.last_user_text_bytes ?? "",
    p.tools_count ?? "",
    p.aura_session_present ? "yes" : "no",
    p.body_cap_error ? "error" : p.body_cap_truncated_ok === true ? "truncated" : "",
    p.cf_ray,
    p.request_contract?.verdict ?? "",
    p.request_contract?.request_kind ?? "",
  ]);

  const comparisonSections = summary.comparisons.map((comparison, idx) => {
    const rows = comparison.diffs.map((diff) => [
      diff.field,
      diff.same ? "same" : "different",
      diff.baseline,
      diff.failure,
    ]);
    return [
      `### Comparison ${idx + 1}: ${comparison.failure.body_hash}`,
      "",
      `Baseline: ${comparison.baseline?.body_hash ?? "none"} (${comparison.baseline?.route ?? "none"})`,
      "",
      markdownTable(["Field", "Result", "Passing", "Failing"], rows),
    ].join("\n");
  }).join("\n\n");

  return [
    "# Phase 1 Request Profile Analysis",
    "",
    `Debug log: \`${summary.debugLog}\``,
    `Profiles considered: ${summary.profiles.length}`,
    "",
    "## Findings",
    "",
    ...summary.findings.map((finding) => `- ${finding}`),
    "",
    "## Profiles",
    "",
    markdownTable(
      [
        "Outcome",
        "Route",
        "Status",
        "Model",
        "Body Hash",
        "Body Bytes",
        "System Bytes",
        "Message Text",
        "Last User",
        "Tools",
        "Session",
        "Body Cap",
        "CF Ray",
        "Contract Verdict",
        "Request Kind",
      ],
      profileRows,
    ),
    "",
    "## Request Contract Verdicts",
    "",
    describeRequestContractSummary(summary.request_contract),
    "",
    "",
    "## Success Vs Failure Diffs",
    "",
    comparisonSections || "No failing profiles found.",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summaryJson = await readJsonIfExists(args.driverSummary);
  const window = runWindow(summaryJson, args.lookbackMs);
  const records = (await readDebugRecords(args.debugLog)).filter((record) => inWindow(record, window));
  const requestContractReports = extractRequestContractReports(records, "phase1-debug");
  const postResponses = records.filter((record) => record.hypothesisId === "H_postresp");
  const profiles = postResponses
    .map((record) => normalizeProfile(record, records, requestContractReports))
    .filter((profile) => profile.outcome === "success" || profile.outcome === "blocked_403")
    .sort((a, b) => profileSortKey(a).localeCompare(profileSortKey(b)));
  const comparisons = chooseComparisons(profiles).map(({ failure, baseline }) => ({
    failure,
    baseline,
    diffs: fieldDiffs(baseline, failure),
  }));
  const summary = {
    ok: true,
    generatedAt: new Date().toISOString(),
    debugLog: args.debugLog,
    driverSummary: args.driverSummary,
    window,
    counts: {
      records: records.length,
      profiles: profiles.length,
      successes: profiles.filter((p) => p.outcome === "success").length,
      blocked403: profiles.filter((p) => p.outcome === "blocked_403").length,
    },
    request_contract: summarizeRequestContractReports(requestContractReports),
    findings: summarizeFindings(profiles, comparisons),
    profiles,
    comparisons,
  };

  await fs.mkdir(args.outDir, { recursive: true });
  const jsonPath = path.join(args.outDir, "phase1-request-profile-analysis.json");
  const mdPath = path.join(args.outDir, "phase1-request-profile-analysis.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderMarkdown(summary), "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    json: jsonPath,
    markdown: mdPath,
    counts: summary.counts,
  })}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[phase1] ${message}\n`);
  process.exit(1);
});
