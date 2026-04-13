import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  selectOrderedWindowIds,
  selectTopWindowId,
  selectWindowById,
  useDesktopWindowStore,
} from "../../stores/desktop-window-store";
import { AgentWindow } from "./AgentWindow";

const DesktopWindowLayerItem = memo(function DesktopWindowLayerItem({
  agentId,
}: {
  agentId: string;
}) {
  const win = useDesktopWindowStore(selectWindowById(agentId));
  const isFocused = useDesktopWindowStore((state) => selectTopWindowId(state) === agentId);

  if (!win) return null;

  return <AgentWindow win={win} isFocused={isFocused} />;
});

export function DesktopWindowLayer() {
  const orderedWindowIds = useDesktopWindowStore(useShallow(selectOrderedWindowIds));

  if (orderedWindowIds.length === 0) return null;

  return (
    <>
      {orderedWindowIds.map((agentId) => (
        <DesktopWindowLayerItem key={agentId} agentId={agentId} />
      ))}
    </>
  );
}
