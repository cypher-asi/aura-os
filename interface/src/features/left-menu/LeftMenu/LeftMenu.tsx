import type { DesktopLeftMenuPaneDefinition } from "../types";
import styles from "./LeftMenu.module.css";

interface LeftMenuProps {
  activeAppId: string;
  panes: DesktopLeftMenuPaneDefinition[];
  visitedAppIds: ReadonlySet<string>;
}

function shouldRenderPane(
  appId: string,
  activeAppId: string,
  visitedAppIds: ReadonlySet<string>,
): boolean {
  return appId === activeAppId || visitedAppIds.has(appId);
}

export function LeftMenu({
  activeAppId,
  panes,
  visitedAppIds,
}: LeftMenuProps) {
  return (
    <div className={styles.root} data-testid="desktop-left-menu">
      {panes.map(({ appId, Pane }) => {
        if (!shouldRenderPane(appId, activeAppId, visitedAppIds)) {
          return null;
        }

        const className = [
          styles.pane,
          appId === activeAppId ? "" : styles.paneHidden,
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={appId}
            className={className}
            data-active={appId === activeAppId || undefined}
            data-testid={`desktop-left-menu-pane-${appId}`}
          >
            <Pane />
          </div>
        );
      })}
    </div>
  );
}
