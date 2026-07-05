import { Bot, CreditCard, FolderPlus, MessageSquare, Sparkles } from "lucide-react";
import type { ComponentType } from "react";

export const ONBOARDING_STORAGE_PREFIX = "aura:onboarding";

export type OnboardingIntent = "chat" | "build";
export type OnboardingRuntime = "web" | "desktop";

export interface OnboardingTaskDef {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
  route: string | null; // null = no navigation (e.g., opens a modal)
}

export const ONBOARDING_TASKS: OnboardingTaskDef[] = [
  {
    id: "send_message",
    label: "Start a conversation",
    description: "Ask Aura anything without creating a project",
    icon: MessageSquare,
    route: "/chat",
  },
  {
    id: "create_project",
    label: "Create a build project",
    description: "Set up a workspace for code, tasks, and agents",
    icon: FolderPlus,
    route: null, // opens NewProjectModal
  },
  {
    id: "create_agent",
    label: "Customize an agent",
    description: "Tune skills, integrations, and behavior",
    icon: Bot,
    route: "/agents",
  },
  {
    id: "try_3d",
    label: "Generate an image",
    description: "Use AURA 3D to create something",
    icon: Sparkles,
    route: "/3d",
  },
  {
    id: "view_billing",
    label: "Review plans & credits",
    description: "See tiers, credit grants, and billing",
    icon: CreditCard,
    route: null, // opens OrgSettings billing
  },
];

const TASKS_BY_ID = new Map(ONBOARDING_TASKS.map((task) => [task.id, task]));

const TASK_ORDER_BY_INTENT: Record<OnboardingIntent, readonly string[]> = {
  chat: ["send_message", "create_project", "create_agent", "try_3d", "view_billing"],
  build: ["create_project", "send_message", "create_agent", "try_3d", "view_billing"],
};

const BUILD_PROJECT_DESCRIPTION_BY_RUNTIME: Record<OnboardingRuntime, string> = {
  desktop: "Open a workspace for local agents, files, and terminal",
  web: "Use remote agents where available, or continue local repos in Desktop",
};

export function getDefaultOnboardingIntent(runtime: OnboardingRuntime): OnboardingIntent {
  return runtime === "desktop" ? "build" : "chat";
}

export function getOnboardingTasks(
  intent: OnboardingIntent | null | undefined,
  runtime: OnboardingRuntime,
): OnboardingTaskDef[] {
  const resolvedIntent = intent ?? getDefaultOnboardingIntent(runtime);
  const order = TASK_ORDER_BY_INTENT[resolvedIntent] ?? TASK_ORDER_BY_INTENT.chat;

  return order.flatMap((taskId): OnboardingTaskDef[] => {
    const task = TASKS_BY_ID.get(taskId);
    if (!task) return [];
    if (task.id === "create_project") {
      return [
        {
          ...task,
          description: BUILD_PROJECT_DESCRIPTION_BY_RUNTIME[runtime],
        },
      ];
    }
    return [task];
  });
}
