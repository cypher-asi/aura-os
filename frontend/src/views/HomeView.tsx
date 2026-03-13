import { Navigate } from "react-router-dom";
import { PageEmptyState } from "@cypher-asi/zui";
import { Rocket } from "lucide-react";

function getLastChat(): { projectId: string; chatSessionId: string } | null {
  try {
    const raw = localStorage.getItem("aura-last-chat");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.projectId && parsed?.chatSessionId) return parsed;
  } catch {
    // ignore malformed data
  }
  return null;
}

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
