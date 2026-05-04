import { Bot, CreditCard, FolderPlus, MessageSquare, Sparkles } from "lucide-react";
import type { ComponentType } from "react";

export const ONBOARDING_STORAGE_PREFIX = "aura:onboarding";

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
    label: "Send your first message",
    description: "Chat with an AI agent",
    icon: MessageSquare,
    route: "/agents",
  },
  {
    id: "create_project",
    label: "Create a project",
    description: "Set up your first workspace",
    icon: FolderPlus,
    route: null, // opens NewProjectModal
  },
  {
    id: "create_agent",
    label: "Create an agent",
    description: "Build your own AI agent",
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
    label: "Explore plans & credits",
    description: "See tiers, credit grants, and billing",
    icon: CreditCard,
    route: null, // opens OrgSettings billing
  },
];
