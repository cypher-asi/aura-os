import { Navigate } from "react-router-dom";
import { PageEmptyState } from "@cypher-asi/zui";
import { Rocket } from "lucide-react";
import { getLastChat } from "../utils/storage";

export function HomeView() {
  const lastChat = getLastChat();

  if (lastChat) {
    return (
      <Navigate
        to={`/projects/${lastChat.projectId}/chat/${lastChat.chatSessionId}`}
        replace
      />
    );
  }

  return (
    <PageEmptyState
      icon={<Rocket size={32} />}
      title="Welcome to AURA"
      description="Select a project from the sidebar or create a new one to get started."
    />
  );
}
