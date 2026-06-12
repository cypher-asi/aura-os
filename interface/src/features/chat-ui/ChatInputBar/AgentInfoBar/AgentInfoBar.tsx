import { memo } from "react";
import { AgentEnvironment } from "../../../../apps/agents/components/AgentEnvironment";
import { OrbitStatusIndicator } from "../../../../components/OrbitStatusIndicator";
import type { Project } from "../../../../shared/types";
import styles from "./AgentInfoBar.module.css";

export interface AgentInfoBarProps {
  machineType?: "local" | "remote";
  /** Resolved agent identity (template id preferred over instance id). */
  agentId?: string;
  workspacePath?: string;
  /** Selected project; drives the orbit indicator and the divider. */
  project?: Project;
}

/**
 * Left side of the info bar under the input pill: agent environment
 * (Local / remote machine) and the project's orbit status, separated by
 * a "·" divider. The divider only renders when the orbit indicator on
 * the right will actually paint something — `OrbitStatusIndicator`
 * returns null without a project, and a hanging dot between two
 * invisible neighbours reads as a glitch (most visibly on the
 * logged-out chat surface and "General" / projectless chats).
 */
export const AgentInfoBar = memo(function AgentInfoBar({
  machineType,
  agentId,
  workspacePath,
  project,
}: AgentInfoBarProps) {
  return (
    <>
      <span className={styles.environmentWrap}>
        <AgentEnvironment
          machineType={machineType}
          agentId={agentId}
          workspacePath={workspacePath}
        />
      </span>
      {project != null ? (
        <span className={styles.infoDivider} aria-hidden="true">
          ·
        </span>
      ) : null}
      <span className={styles.orbitWrap}>
        <OrbitStatusIndicator project={project} />
      </span>
    </>
  );
});
