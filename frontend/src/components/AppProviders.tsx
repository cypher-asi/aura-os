import { OrgProvider } from "../context/OrgContext";
import { AppProvider } from "../context/AppContext";
import { SidebarSearchProvider } from "../context/SidebarSearchContext";
import { ProjectsProvider } from "../apps/projects/ProjectsProvider";
import { AgentAppProvider } from "../apps/agents/AgentAppProvider";
import { FeedProvider } from "../apps/feed/FeedProvider";
import { LeaderboardProvider } from "../apps/leaderboard/LeaderboardContext";
import { ProfileProvider } from "../apps/profile/ProfileProvider";
import { apps } from "../apps/registry";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <OrgProvider>
      <AppProvider apps={apps}>
        <SidebarSearchProvider>
          <ProjectsProvider>
            <AgentAppProvider>
              <FeedProvider>
                <LeaderboardProvider>
                  <ProfileProvider>
                    {children}
                  </ProfileProvider>
                </LeaderboardProvider>
              </FeedProvider>
            </AgentAppProvider>
          </ProjectsProvider>
        </SidebarSearchProvider>
      </AppProvider>
    </OrgProvider>
  );
}
