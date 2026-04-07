import type { CSSProperties } from "react";
import type { ProcessNodeType } from "../../../../types/enums";

export const NODE_TYPE_LABELS: Record<ProcessNodeType, string> = {
  ignition: "Ignition",
  action: "Action",
  condition: "Condition",
  artifact: "Artifact",
  delay: "Delay",
  merge: "Merge",
  prompt: "Prompt",
  sub_process: "SubProcess",
  for_each: "ForEach",
  group: "Group",
};

export const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-input)",
  color: "var(--color-text)",
  colorScheme: "dark",
  fontSize: 13,
  fontFamily: "inherit",
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
};

export const ARTIFACT_TYPE_OPTIONS = [
  { value: "report", label: "Report" },
  { value: "data", label: "Data" },
  { value: "media", label: "Media" },
  { value: "code", label: "Code" },
  { value: "custom", label: "Custom" },
] as const;

export const ARTIFACT_MODE_OPTIONS = [
  { value: "prompt", label: "Prompt" },
  { value: "json_schema", label: "JSON Schema" },
] as const;
