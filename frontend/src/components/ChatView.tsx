import { Text } from "@cypher-asi/zui";
import { MessageSquare } from "lucide-react";

export function ChatView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "var(--space-3)", color: "var(--color-text-muted)" }}>
      <MessageSquare size={40} style={{ opacity: 0.3 }} />
      <Text variant="muted" size="sm">Chat view — coming soon</Text>
    </div>
  );
}
