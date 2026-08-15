import { useEffect, useMemo, useState } from "react";
import { api } from "../../../api/client";
import type { AgentProjectBinding } from "../../../shared/api/agents";

const EMPTY_BINDINGS: AgentProjectBinding[] = [];

/**
 * Loads every project in which an agent identity is installed. Failed
 * discovery is intentionally non-fatal: the current project remains visible
 * and the picker simply stays inert.
 */
export function useAgentProjectBindings(agentId: string | null) {
  const [result, setResult] = useState<{
    agentId: string | null;
    bindings: AgentProjectBinding[];
  }>({ agentId: null, bindings: EMPTY_BINDINGS });

  useEffect(() => {
    if (!agentId) return;

    const controller = new AbortController();
    void api.agents
      .listProjectBindings(agentId)
      .then((bindings) => {
        if (!controller.signal.aborted) {
          setResult({ agentId, bindings: dedupeProjectBindings(bindings) });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ agentId, bindings: EMPTY_BINDINGS });
        }
      });

    return () => controller.abort();
  }, [agentId]);

  return useMemo(
    () => (result.agentId === agentId ? result.bindings : EMPTY_BINDINGS),
    [agentId, result],
  );
}

export function dedupeProjectBindings(
  bindings: readonly AgentProjectBinding[],
): AgentProjectBinding[] {
  const seen = new Set<string>();
  return bindings.filter((binding) => {
    if (seen.has(binding.project_id)) return false;
    seen.add(binding.project_id);
    return true;
  });
}
