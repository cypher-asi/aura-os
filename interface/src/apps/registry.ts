import { ProjectsApp } from "./projects/ProjectsApp";
import { AgentsApp } from "./agents/AgentsApp";
import { TasksApp } from "./tasks/TasksApp";
import { ProcessApp } from "./process/ProcessApp";
import { FeedApp } from "./feed/FeedApp";
import { ProfileApp } from "./profile/ProfileApp";
import { DesktopApp } from "./desktop/DesktopApp/index";
import type { AuraApp } from "./types";

export const apps: AuraApp[] = [AgentsApp, ProjectsApp, TasksApp, ProcessApp, FeedApp, ProfileApp, DesktopApp];
