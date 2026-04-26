import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");
const protocolBindingsDir = join(repoRoot, "crates", "aura-protocol", "bindings");
const generatedProtocolDir = join(
  repoRoot,
  "interface",
  "src",
  "shared",
  "types",
  "generated",
  "protocol",
);

const permissionBindingFiles = [
  "AgentPermissionsWire.ts",
  "AgentScopeWire.ts",
  "CapabilityWire.ts",
  "IntentClassifierRule.ts",
  "IntentClassifierSpec.ts",
];

await mkdir(generatedProtocolDir, { recursive: true });

for (const fileName of permissionBindingFiles) {
  await copyFile(
    join(protocolBindingsDir, fileName),
    join(generatedProtocolDir, fileName),
  );
}

await rm(protocolBindingsDir, { recursive: true, force: true });
