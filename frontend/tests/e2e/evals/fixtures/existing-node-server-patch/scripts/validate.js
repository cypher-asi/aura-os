const fs = require("node:fs");
const path = require("node:path");

const serverPath = path.join(process.cwd(), "server.js");

if (!fs.existsSync(serverPath)) {
  console.error("Expected server.js to exist.");
  process.exit(1);
}

const source = fs.readFileSync(serverPath, "utf8");

const checks = [
  { label: "patched heading", passed: source.includes("Aura Patch Complete") },
  { label: "patched footer", passed: source.includes("Patched by Aura") },
  { label: "health route", passed: source.includes("/health") && source.includes("source") && source.includes("patched") },
  { label: "port env", passed: source.includes("process.env.PORT") },
];

const failures = checks.filter((check) => !check.passed);

if (failures.length > 0) {
  console.error(`Validation failed for: ${failures.map((check) => check.label).join(", ")}`);
  process.exit(1);
}

console.log("Existing server patch benchmark fixture validated successfully.");
