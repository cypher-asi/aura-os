import { ProjectsApp } from "./projects/ProjectsApp";
import { AgentsApp } from "./agents/AgentsApp";
import { TasksApp } from "./tasks/TasksApp";
import { CronApp } from "./cron/CronApp";
import { ProcessApp } from "./process/ProcessApp";
import { FeedApp } from "./feed/FeedApp";
import { LeaderboardApp } from "./leaderboard/LeaderboardApp";
import { ProfileApp } from "./profile/ProfileApp";
import { DesktopApp } from "./desktop/DesktopApp";
import type { AuraApp } from "./types";

export const apps: AuraApp[] = [AgentsApp, ProjectsApp, TasksApp, ProcessApp, CronApp, FeedApp, LeaderboardApp, ProfileApp, DesktopApp];
