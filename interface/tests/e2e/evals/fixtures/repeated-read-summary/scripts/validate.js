const fs = require("node:fs");
const path = require("node:path");

const summaryPath = path.join(process.cwd(), "summary.md");

if (!fs.existsSync(summaryPath)) {
  console.error("Expected summary.md to exist.");
  process.exit(1);
}

const summary = fs.readFileSync(summaryPath, "utf8").toLowerCase();

const checks = [
  { label: "overview heading", passed: summary.includes("overview") },
  { label: "signals heading", passed: summary.includes("signals") },
  { label: "checklist heading", passed: summary.includes("checklist") },
  { label: "cache usage", passed: summary.includes("cache") },
  { label: "context pressure", passed: summary.includes("context") },
  { label: "reliability", passed: summary.includes("reliability") },
];

const failures = checks.filter((check) => !check.passed);

if (failures.length > 0) {
  console.error(`Validation failed for: ${failures.map((check) => check.label).join(", ")}`);
  process.exit(1);
}

console.log("Repeated read summary fixture validated successfully.");
