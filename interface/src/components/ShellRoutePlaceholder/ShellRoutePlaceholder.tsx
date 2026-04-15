import { PageEmptyState } from "@cypher-asi/zui";
import { LayoutTemplate } from "lucide-react";

type ShellRoutePlaceholderProps = {
  title: string;
  description?: string;
};

/** Visible placeholder for shell routes that are not implemented yet (replaces blank `null` routes). */
export function ShellRoutePlaceholder({ title, description }: ShellRoutePlaceholderProps) {
  return (
    <PageEmptyState
      icon={<LayoutTemplate size={32} />}
      title={title}
      description={description ?? "This area is not available in the web app yet."}
    />
  );
}
