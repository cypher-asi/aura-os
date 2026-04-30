const ACCEPT_VERDICTS = new Set(["accept", "accepted", "ok", "pass", "passed", "warn", "warning"]);
const BLOCK_VERDICTS = new Set([
  "block",
  "blocked",
  "reject",
  "rejected",
  "violation",
  "local_block",
  "local_violation",
  "modelrequestcontractviolation",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeReasonList(...values) {
  const out = [];
  const add = (value) => {
    if (typeof value === "string" && value.trim()) {
      out.push(value.trim());
    } else if (Array.isArray(value)) {
      for (const item of value) add(item);
    } else if (isObject(value)) {
      const code = firstString(value.code, value.reason, value.kind, value.name);
      const message = firstString(value.message, value.detail, value.description);
      if (code && message) out.push(`${code}: ${message}`);
      else if (code || message) out.push(code || message);
    }
  };
  for (const value of values) add(value);
  return [...new Set(out)];
}

function normalizeVerdict(value) {
  const raw = firstString(value);
  if (!raw) return "";
  return raw.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function compactCloudflareHtml(value) {
  const text = String(value ?? "");
  if (!text) return "";
  const lower = text.toLowerCase();
  const cfRay = text.match(/\bcf-ray[:=]\s*([A-Za-z0-9-]+)/i)?.[1]
    || text.match(/\bcf-ray["'<>\s:=/.-]*([A-Za-z0-9-]{8,})/i)?.[1]
    || "";
  if (
    lower.includes("<!doctype html")
    || lower.includes("cloudflare")
    || lower.includes("attention required")
    || lower.includes("data-translate=\"block_headline\"")
  ) {
    return [
      "Cloudflare HTML 403 returned by the provider/router path",
      cfRay ? `cf-ray=${cfRay}` : "",
      "local request-contract verdict was not available in this error payload",
    ].filter(Boolean).join("; ");
  }
  return text.replace(/\s+/g, " ").trim();
}

function candidateProfileObjects(data) {
  return [
    data,
    data?.request_contract,
    data?.requestContract,
    data?.request_contract_verdict,
    data?.requestContractVerdict,
    data?.classifier_verdict,
    data?.classifierVerdict,
    data?.content_profile,
    data?.contentProfile,
    data?.model_content_profile,
    data?.modelContentProfile,
    data?.profile,
  ].filter(isObject);
}

export function extractRequestContractReport(input, source = "unknown") {
  const record = isObject(input) ? input : {};
  const data = isObject(record.data) ? record.data : record;
  const hypothesisId = firstString(record.hypothesisId, record.hypothesis_id);
  const message = firstString(record.message);
  const objects = candidateProfileObjects(data);

  for (const obj of objects) {
    const verdict = normalizeVerdict(
      obj.verdict
        ?? obj.status
        ?? obj.outcome
        ?? obj.decision
        ?? obj.classification
        ?? obj.request_contract_verdict
        ?? obj.requestContractVerdict
        ?? obj.classifier_verdict
        ?? obj.classifierVerdict,
    );
    const requestKind = firstString(
      obj.request_kind,
      obj.requestKind,
      obj.kind,
      obj.model_request_kind,
      obj.modelRequestKind,
    );
    const contentSignature = firstString(
      obj.content_signature,
      obj.contentSignature,
      obj.signature,
      obj.content_hash,
      obj.contentHash,
    );
    const bodyHash = firstString(obj.body_hash, obj.bodyHash, data.body_hash, data.bodyHash);
    const hasContractShape = verdict
      || requestKind
      || contentSignature
      || obj.reasons
      || obj.reason
      || obj.violations
      || obj.violation
      || /contract|content.?profile|classifier/i.test(`${hypothesisId} ${message}`);
    if (!hasContractShape || !verdict) continue;

    return {
      available: true,
      source,
      hypothesisId,
      line: record.__line ?? null,
      timestamp: Number(record.timestamp ?? obj.timestamp ?? 0) || null,
      verdict,
      accepted: ACCEPT_VERDICTS.has(verdict) && !BLOCK_VERDICTS.has(verdict),
      blocked: BLOCK_VERDICTS.has(verdict),
      request_kind: requestKind,
      route: firstString(obj.route, data.route),
      content_signature: contentSignature,
      body_hash: bodyHash,
      reasons: normalizeReasonList(
        obj.reasons,
        obj.reason,
        obj.violations,
        obj.violation,
        obj.reason_codes,
        obj.reasonCodes,
      ),
      remediation_hint: firstString(obj.remediation_hint, obj.remediationHint, obj.hint),
    };
  }
  return null;
}

export function extractRequestContractReports(records, source = "debug") {
  if (!Array.isArray(records)) return [];
  const reports = [];
  for (const [idx, record] of records.entries()) {
    const report = extractRequestContractReport(record, `${source}:${idx + 1}`);
    if (report) reports.push(report);
  }
  return reports;
}

export function summarizeRequestContractReports(reports) {
  const safe = Array.isArray(reports) ? reports.filter(Boolean) : [];
  const verdict_counts = {};
  const request_kind_counts = {};
  const blocked = [];
  for (const report of safe) {
    const verdict = report.verdict || "unknown";
    verdict_counts[verdict] = (verdict_counts[verdict] ?? 0) + 1;
    if (report.request_kind) {
      request_kind_counts[report.request_kind] = (request_kind_counts[report.request_kind] ?? 0) + 1;
    }
    if (report.blocked) blocked.push(report);
  }
  return {
    available: safe.length > 0,
    total: safe.length,
    accepted: safe.filter((r) => r.accepted).length,
    blocked: blocked.length,
    verdict_counts,
    request_kind_counts,
    acceptance: safe.length === 0 ? "not_available" : blocked.length > 0 ? "fail" : "pass",
    first_blocked: blocked[0] ?? null,
  };
}

export function describeRequestContractSummary(summary) {
  if (!summary?.available) {
    return "request contract verdicts: not available (core classifier/profile telemetry was not emitted)";
  }
  const counts = Object.entries(summary.verdict_counts ?? {})
    .map(([verdict, count]) => `${verdict}=${count}`)
    .join(", ");
  return `request contract verdicts: ${summary.acceptance}${counts ? ` (${counts})` : ""}`;
}

export function extractTypedFailureReport({ error = null, payload = null, requestContractSummary = null } = {}) {
  const message = error instanceof Error ? error.message : firstString(error?.message, error);
  const payloadReports = extractRequestContractReports([
    payload?.request_contract,
    payload?.requestContract,
    payload?.request_contract_verdict,
    payload?.requestContractVerdict,
    payload?.classifier_verdict,
    payload?.classifierVerdict,
  ].filter(Boolean), "payload");
  const payloadSummary = summarizeRequestContractReports(payloadReports);
  const contractSummary = requestContractSummary?.available ? requestContractSummary : payloadSummary;
  if (contractSummary?.first_blocked) {
    const blocked = contractSummary.first_blocked;
    return {
      type: "request_contract_violation",
      message: [
        `local request contract violation: ${blocked.verdict}`,
        blocked.request_kind ? `kind=${blocked.request_kind}` : "",
        blocked.content_signature ? `content_signature=${blocked.content_signature}` : "",
        blocked.reasons?.length ? `reasons=${blocked.reasons.join("; ")}` : "",
        blocked.remediation_hint ? `hint=${blocked.remediation_hint}` : "",
      ].filter(Boolean).join("; "),
      request_contract: contractSummary,
    };
  }

  const typedMatch = message.match(
    /\b(ModelRequestContractViolation|MissingStableSessionId|UnboundedBootstrapContext|EmergencyCapRequired|OversizedToolResult|UnknownRequestKind|verification_environment_blocked|agent_patch_polluted)\b(?::\s*([^<\n\r]+))?/i,
  );
  if (typedMatch) {
    return {
      type: "typed_local_failure",
      message: typedMatch[2] ? `${typedMatch[1]}: ${typedMatch[2].trim()}` : typedMatch[1],
      request_contract: contractSummary,
    };
  }

  const compact = compactCloudflareHtml(message);
  if (/cloudflare|cf-ray|html 403/i.test(compact)) {
    return {
      type: "cloudflare_block",
      message: compact,
      request_contract: contractSummary,
    };
  }

  return {
    type: "agent_error",
    message: compact || "agent failed without a typed local reason",
    request_contract: contractSummary,
  };
}
