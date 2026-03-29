import { AutomationBar } from "../AutomationBar";
import { useSidekick } from "../../stores/sidekick-store";
import { useProjectContext } from "../../stores/project-action-store";

export function SidekickHeader() {
  const ctx = useProjectContext();
  const { showInfo } = useSidekick();
  if (!ctx || showInfo) return null;
  return <AutomationBar projectId={ctx.project.project_id} />;
}
