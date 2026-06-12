export function readPath(object, path) {
  return path.split(".").reduce((value, part) => {
    if (value == null || typeof value !== "object") return undefined;
    return value[part];
  }, object);
}

function describeValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function validateAssertion(assertion, evidence) {
  const path = assertion?.path;
  if (typeof path !== "string" || path.length === 0) return "Invalid assertion path";
  const value = readPath(evidence, path);
  const label = assertion.description || path;

  if (value === undefined || value === null) {
    return `${label} is missing`;
  }
  if (Object.hasOwn(assertion, "equals") && value !== assertion.equals) {
    return `${label} expected ${describeValue(assertion.equals)} but got ${describeValue(value)}`;
  }
  if (Array.isArray(assertion.oneOf) && !assertion.oneOf.includes(value)) {
    return `${label} expected one of ${assertion.oneOf.map(describeValue).join(", ")} but got ${describeValue(value)}`;
  }
  if (Object.hasOwn(assertion, "min")) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < Number(assertion.min)) {
      return `${label} expected >= ${assertion.min} but got ${describeValue(value)}`;
    }
  }
  if (Object.hasOwn(assertion, "max")) {
    const number = Number(value);
    if (!Number.isFinite(number) || number > Number(assertion.max)) {
      return `${label} expected <= ${assertion.max} but got ${describeValue(value)}`;
    }
  }
  if (assertion.nonEmpty === true) {
    const size = Array.isArray(value) || typeof value === "string" ? value.length : Object.keys(value ?? {}).length;
    if (size === 0) return `${label} expected a non-empty value`;
  }
  if (typeof assertion.contains === "string") {
    const found = Array.isArray(value) ? value.includes(assertion.contains) : String(value).includes(assertion.contains);
    if (!found) return `${label} expected to contain ${describeValue(assertion.contains)}`;
  }
  if (typeof assertion.containsIgnoreCase === "string") {
    const needle = assertion.containsIgnoreCase.toLowerCase();
    const found = Array.isArray(value)
      ? value.some((entry) => String(entry).toLowerCase().includes(needle))
      : String(value).toLowerCase().includes(needle);
    if (!found) return `${label} expected to contain ${describeValue(assertion.containsIgnoreCase)}`;
  }
  return null;
}

export function validateCheckEvidence(checkId, result, expectations) {
  if (!expectations || result.status === "skip") return null;
  const expectation = expectations.checks?.[checkId];
  if (!expectation) {
    return `No expected-output contract registered for ${checkId}`;
  }

  const missing = (expectation.requiredEvidence ?? []).filter((path) => {
    const value = readPath(result.evidence ?? {}, path);
    return value === undefined || value === null;
  });

  if (missing.length > 0) {
    return `Missing expected evidence: ${missing.join(", ")}`;
  }

  const assertionErrors = (expectation.assertions ?? [])
    .map((assertion) => validateAssertion(assertion, result.evidence ?? {}))
    .filter(Boolean);
  if (assertionErrors.length > 0) {
    return `Expected evidence assertion failed: ${assertionErrors.join("; ")}`;
  }
  return null;
}
