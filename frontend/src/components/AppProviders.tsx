import { useEffect, useRef } from "react";
import type { ComponentType, ReactNode } from "react";
import { OrgProvider } from "../context/OrgContext";
import { AppProvider, useAppContext } from "../context/AppContext";
import { SidebarActionProvider } from "../context/SidebarActionContext";
import { ProjectsProvider } from "../apps/projects/ProjectsProvider";
import { FeedProvider } from "../apps/feed/FeedProvider";
import { LeaderboardProvider } from "../apps/leaderboard/LeaderboardContext";
import { ProfileProvider } from "../apps/profile/ProfileProvider";
import { useAppUIStore } from "../stores/app-ui-store";
import { apps } from "../apps/registry";

function VisitTracker(): null {
  const { activeApp } = useAppContext();
  const markAppVisited = useAppUIStore((s) => s.markAppVisited);

  useEffect(() => {
    markAppVisited(activeApp.id);
  }, [activeApp.id, markAppVisited]);

  return null;
}

function LazyAppProvider({
  appId,
  Provider,
  children,
}: {
  appId: string;
  Provider: ComponentType<{ children: ReactNode }>;
  children: ReactNode;
}): ReactNode {
  const { activeApp } = useAppContext();
  const visitedAppIds = useAppUIStore((s) => s.visitedAppIds);
  const activated = useRef(false);
  if (visitedAppIds.has(appId) || activeApp.id === appId) activated.current = true;
  if (!activated.current) return <>{children}</>;
  return <Provider>{children}</Provider>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <OrgProvider>
      <AppProvider apps={apps}>
        <SidebarActionProvider>
          <VisitTracker />
          <ProjectsProvider>
            <LazyAppProvider appId="feed" Provider={FeedProvider}>
              <LazyAppProvider appId="leaderboard" Provider={LeaderboardProvider}>
                <LazyAppProvider appId="profile" Provider={ProfileProvider}>
                  {children}
                </LazyAppProvider>
              </LazyAppProvider>
            </LazyAppProvider>
          </ProjectsProvider>
        </SidebarActionProvider>
      </AppProvider>
    </OrgProvider>
  );
}
