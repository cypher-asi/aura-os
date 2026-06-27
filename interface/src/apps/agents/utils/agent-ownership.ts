import type { Agent, ZeroUser } from "../../../shared/types";

export function isAgentOwnedByUser(
  agent: Agent | null | undefined,
  user: ZeroUser | null | undefined,
): boolean {
  if (!agent || !user) return false;
  return user.network_user_id === agent.user_id || user.user_id === agent.user_id;
}
