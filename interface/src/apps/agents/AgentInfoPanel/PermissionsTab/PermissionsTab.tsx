import { useCallback, useState } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { ShieldCheck, X } from "lucide-react";
import { useAgentStore } from "../../stores";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { useOrgStore } from "../../../../stores/org-store";
import type { Agent } from "../../../../shared/types";
import {
  CAPABILITY_LABELS,
  GLOBAL_CAPABILITY_TYPES,
  isSuperAgent,
} from "../../../../shared/types/permissions";
import { Toggle } from "@cypher-asi/zui";
import styles from "../AgentInfoPanel.module.css";
import { shortenId } from "./permissions-utils";
import {
  ActiveHarnessToolsSection,
  AutosaveStatus,
  ProjectAccessModePicker,
  ProjectAccessPicker,
  ScopeRow,
} from "./permissions-rows";
import { usePermissionsForm } from "./usePermissionsForm";
import { usePermissionsAutosave } from "./usePermissionsAutosave";

interface PermissionsTabProps {
  agent: Agent;
  isOwnAgent: boolean;
}

export function PermissionsTab({ agent, isOwnAgent }: PermissionsTabProps) {
  const form = usePermissionsForm(agent, isOwnAgent);
  const {
    draft,
    lastSavedRef,
    draftRef,
    universeScope,
    canEdit,
    globalEnabled,
    projectAccessByProject,
    projectCapIds,
    setScope,
    toggleGlobalCapability,
    removeProjectAccess,
    addProjectAccess,
  } = form;
  const { status, toolsRefreshKey, retry } = usePermissionsAutosave({
    agentId: agent.agent_id,
    draft,
    canEdit,
    lastSavedRef,
    draftRef,
  });

  const [projectPickerStep, setProjectPickerStep] = useState<
    null | { stage: "project" } | { stage: "mode"; projectId: string }
  >(null);

  const projects = useProjectsListStore((s) => s.projects);
  const agents = useAgentStore((s) => s.agents);
  const orgs = useOrgStore((s) => s.orgs);

  const projectNameFor = useCallback(
    (id: string) => projects.find((p) => p.project_id === id)?.name,
    [projects],
  );
  const agentNameFor = useCallback(
    (id: string) => agents.find((a) => a.agent_id === id)?.name,
    [agents],
  );
  const orgNameFor = useCallback(
    (id: string) => orgs.find((o) => o.org_id === id)?.name,
    [orgs],
  );

  return (
    <>
      {isSuperAgent(agent) && (
        <div className={styles.permsCeoCard}>
          <ShieldCheck size={18} className={styles.permsCeoIcon} />
          <div className={styles.permsCeoBody}>
            <Text size="sm" weight="medium">
              CEO preset — universe scope, every core capability.
            </Text>
            <Text size="xs" variant="muted">
              CEO permissions are locked to prevent self-lockout.
            </Text>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.permsSectionHeader}>
          <span className={styles.permsSectionTitle}>Scope</span>
          {canEdit && <AutosaveStatus status={status} onRetry={retry} />}
        </div>
        {universeScope ? (
          <div className={styles.permsChipRow}>
            <span className={styles.permsChip}>
              <span className={styles.permsChipText}>
                Universe — every org, project, and agent
              </span>
            </span>
          </div>
        ) : (
          <>
            <ScopeRow
              label="Orgs"
              axis="orgs"
              ids={draft.scope.orgs}
              canEdit={canEdit}
              nameFor={orgNameFor}
              onAdd={(id) => setScope("orgs", [...draft.scope.orgs, id])}
              onRemove={(id) =>
                setScope(
                  "orgs",
                  draft.scope.orgs.filter((x) => x !== id),
                )
              }
            />
            <ScopeRow
              label="Projects"
              axis="projects"
              ids={draft.scope.projects}
              canEdit={canEdit}
              nameFor={projectNameFor}
              onAdd={(id) =>
                setScope("projects", [...draft.scope.projects, id])
              }
              onRemove={(id) =>
                setScope(
                  "projects",
                  draft.scope.projects.filter((x) => x !== id),
                )
              }
            />
            <ScopeRow
              label="Agent IDs"
              axis="agent_ids"
              ids={draft.scope.agent_ids}
              canEdit={canEdit}
              nameFor={agentNameFor}
              onAdd={(id) =>
                setScope("agent_ids", [...draft.scope.agent_ids, id])
              }
              onRemove={(id) =>
                setScope(
                  "agent_ids",
                  draft.scope.agent_ids.filter((x) => x !== id),
                )
              }
            />
          </>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.permsSectionHeader}>
          <span className={styles.permsSectionTitle}>Capabilities</span>
        </div>
        {GLOBAL_CAPABILITY_TYPES.map((type) => {
          const meta = CAPABILITY_LABELS[type];
          const Icon = meta.Icon;
          const checked = globalEnabled.has(type);
          return (
            <div key={type} className={styles.permsCapabilityRow}>
              <Icon size={14} className={styles.permsCapabilityIcon} />
              <div className={styles.permsCapabilityText}>
                <span className={styles.permsCapabilityLabel}>{meta.label}</span>
                <span className={styles.permsCapabilityDescription}>
                  {meta.description}
                </span>
              </div>
              <Toggle
                size="sm"
                checked={checked}
                disabled={!canEdit}
                onChange={() => toggleGlobalCapability(type)}
                aria-label={meta.label}
                className={styles.permsCapabilityToggle}
              />
            </div>
          );
        })}
      </div>

      <ActiveHarnessToolsSection
        agentId={agent.agent_id}
        refreshKey={toolsRefreshKey}
      />

      <div className={styles.section}>
        <div className={styles.permsSectionHeader}>
          <span className={styles.permsSectionTitle}>Project access</span>
          {canEdit && (
            <div className={styles.permsPickerWrapper}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setProjectPickerStep({ stage: "project" })}
              >
                Add project access
              </Button>
              {projectPickerStep?.stage === "project" && (
                <ProjectAccessPicker
                  excludeIds={projectCapIds}
                  onPick={(projectId) =>
                    setProjectPickerStep({ stage: "mode", projectId })
                  }
                  onClose={() => setProjectPickerStep(null)}
                />
              )}
              {projectPickerStep?.stage === "mode" && (
                <ProjectAccessModePicker
                  onPick={(mode) => {
                    addProjectAccess(projectPickerStep.projectId, mode);
                    setProjectPickerStep(null);
                  }}
                  onClose={() => setProjectPickerStep(null)}
                />
              )}
            </div>
          )}
        </div>
        {projectAccessByProject.size === 0 ? (
          <span className={styles.permsEmpty}>No project access granted</span>
        ) : (
          Array.from(projectAccessByProject.entries()).map(
            ([projectId, access]) => (
              <div key={projectId} className={styles.permsProjectGroup}>
                <span
                  className={styles.permsProjectName}
                  title={projectId}
                >
                  {projectNameFor(projectId) ?? shortenId(projectId)}
                </span>
                <div className={styles.permsProjectBadges}>
                  {access.read && (
                    <span className={styles.permsChip}>
                      <span className={styles.permsChipText}>Read</span>
                      {canEdit && (
                        <button
                          type="button"
                          className={styles.permsChipRemove}
                          onClick={() => removeProjectAccess(projectId, "read")}
                          aria-label="Remove read access"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </span>
                  )}
                  {access.write && (
                    <span className={styles.permsChip}>
                      <span className={styles.permsChipText}>Write</span>
                      {canEdit && (
                        <button
                          type="button"
                          className={styles.permsChipRemove}
                          onClick={() => removeProjectAccess(projectId, "write")}
                          aria-label="Remove write access"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </div>
            ),
          )
        )}
      </div>

    </>
  );
}
