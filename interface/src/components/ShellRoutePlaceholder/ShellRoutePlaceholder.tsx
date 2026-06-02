import { PageEmptyState } from "@cypher-asi/zui";
import { LayoutTemplate } from "lucide-react";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";

type ShellRoutePlaceholderProps = {
  title: string;
  description?: string;
};

/** Visible placeholder for shell routes that are not implemented yet (replaces blank `null` routes). */
export function ShellRoutePlaceholder({ title, description }: ShellRoutePlaceholderProps) {
  const { isMobileLayout } = useAuraCapabilities();
  const fallbackDescription = isMobileLayout ? "This area is not available yet." : "This area is not available in the web app yet.";

  return (
    <div
      data-agent-surface="shell-route-placeholder"
      data-agent-empty-state="true"
      data-agent-placeholder-title={title}
      aria-label={`${title} placeholder`}
    >
      <PageEmptyState
        icon={<LayoutTemplate size={32} />}
        title={title}
        description={description ?? fallbackDescription}
      />
    </div>
  );
}
