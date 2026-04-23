import { AutomationBar } from "../AutomationBar";
import { PushStuckBanner } from "../PushStuckBanner";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";

export function SidekickHeader() {
  const ctx = useProjectActions();
  const showInfo = useSidekickStore((s) => s.showInfo);
  if (!ctx || showInfo) return null;
  const projectId = ctx.project.project_id;
  return (
    <>
      <PushStuckBanner projectId={projectId} />
      <AutomationBar projectId={projectId} />
    </>
  );
}