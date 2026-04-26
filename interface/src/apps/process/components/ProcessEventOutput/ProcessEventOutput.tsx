import { useMemo, useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import type { ProcessEvent } from "../../../../shared/types";
import { LLMOutput } from "../../../chat/components/LLMOutput";
import { monoBox, prettyPrintIfJson } from "../NodeOutputTab/node-output-utils";
import { buildProcessEventDisplay } from "./process-event-display";

interface Props {
  event: ProcessEvent;
}

export function ProcessEventOutput({ event }: Props) {
  const { message, separateOutput } = useMemo(
    () => buildProcessEventDisplay(event),
    [event],
  );

  return (
    <>
      {message && (
        <LLMOutput
          content={message.content}
          timeline={message.timeline}
          toolCalls={message.toolCalls}
          thinkingText={message.thinkingText}
          thinkingDurationMs={message.thinkingDurationMs}
          artifactRefs={message.artifactRefs}
        />
      )}
      {separateOutput && <FormattedOutput text={separateOutput} />}
    </>
  );
}

function FormattedOutput({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const formatted = useMemo(() => prettyPrintIfJson(text), [text]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [formatted]);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={handleCopy}
        title="Copy output"
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          display: "flex",
          alignItems: "center",
          gap: 3,
          background: "var(--color-bg-secondary, rgba(0,0,0,0.3))",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
          padding: "2px 6px",
          cursor: "pointer",
          fontSize: 10,
          color: "var(--color-text-muted)",
          zIndex: 1,
        }}
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <div style={monoBox}>{formatted}</div>
    </div>
  );
}
