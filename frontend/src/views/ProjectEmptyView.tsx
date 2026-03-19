import { Bot } from "lucide-react";
import { EmptyState } from "../components/EmptyState";

/**
 * Shown in the main area when a project is selected but has no agent yet.
 * Matches the empty-state style of the right sidebar ("No specs yet").
 */
export function ProjectEmptyView() {
  return (
    <EmptyState icon={<Bot size={32} />}>
      No agent yet. Add an agent to get started.
    </EmptyState>
  );
}
