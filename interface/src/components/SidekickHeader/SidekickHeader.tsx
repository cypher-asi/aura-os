import { AutomationBar } from "../AutomationBar";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";

export function SidekickHeader() {
  const ctx = useProjectActions();
  const showInfo = useSidekickStore((s) => s.showInfo);
  if (!ctx || showInfo) return null;
  return <AutomationBar projectId={ctx.project.project_id} />;
}
