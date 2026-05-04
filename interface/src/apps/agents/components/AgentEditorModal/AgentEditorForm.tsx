import { Input, Textarea, Text } from "@cypher-asi/zui";
import { ImagePlus, X, Monitor, Cloud, Globe2, Lock, Info } from "lucide-react";
import type { AgentListingStatus } from "../../../marketplace/listing-status";
import styles from "./AgentEditorModal.module.css";

function CompactEnvironmentPicker({
  environment,
  setEnvironment,
  allowLocal = true,
}: {
  environment: string;
  setEnvironment: (v: string) => void;
  allowLocal?: boolean;
}) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>Environment</label>
      <div className={styles.envGrid}>
        <button
          type="button"
          className={`${styles.envOption} ${environment === "swarm_microvm" ? styles.envOptionActive : ""}`}
          onClick={() => setEnvironment("swarm_microvm")}
        >
          <Cloud size={14} />
          Remote
        </button>
        {allowLocal ? (
          <button
            type="button"
            className={`${styles.envOption} ${environment === "local_host" ? styles.envOptionActive : ""}`}
            onClick={() => setEnvironment("local_host")}
          >
            <Monitor size={14} />
            Local
          </button>
        ) : null}
      </div>
    </div>
  );
}

export interface AgentEditorFormProps {
  name: string;
  setName: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  isSuperAgent: boolean;
  personality: string;
  setPersonality: (v: string) => void;
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  icon: string;
  environment: string;
  setEnvironment: (v: string) => void;
  showAdvancedRuntime: boolean;
  setShowAdvancedRuntime: (v: boolean) => void;
  listingStatus: AgentListingStatus;
  setListingStatus: (v: AgentListingStatus) => void;
  simplifyForMobileCreate: boolean;
  restrictCreateToAuraRuntimes: boolean;
  nameError: string;
  setNameError: (v: string) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  error: string;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleAvatarClick: () => void;
  handleAvatarRemove: () => void;
}

export function AgentEditorForm({
  name,
  setName,
  role,
  setRole,
  isSuperAgent,
  personality,
  setPersonality,
  systemPrompt,
  setSystemPrompt,
  icon,
  environment,
  setEnvironment,
  showAdvancedRuntime,
  setShowAdvancedRuntime,
  listingStatus,
  setListingStatus,
  simplifyForMobileCreate,
  restrictCreateToAuraRuntimes,
  nameError,
  setNameError,
  nameRef,
  fileInputRef,
  error,
  handleFileSelect,
  handleAvatarClick,
  handleAvatarRemove,
}: AgentEditorFormProps) {
  return (
    <div className={styles.form} data-agent-surface="agent-editor-form">
      <div className={styles.avatarRow}>
        <button
          type="button"
          className={styles.avatarUpload}
          onClick={handleAvatarClick}
        >
          {icon ? (
            <img
              src={icon}
              alt="Agent avatar"
              className={styles.avatarImg}
            />
          ) : (
            <ImagePlus size={20} className={styles.avatarPlaceholder} />
          )}
          {icon && (
            <span
              className={styles.avatarRemove}
              onClick={(e) => {
                e.stopPropagation();
                handleAvatarRemove();
              }}
            >
              <X size={12} />
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className={styles.hiddenInput}
          onChange={handleFileSelect}
        />
      </div>

      <div className={styles.nameRoleRow}>
        <div className={styles.fieldGroup} data-agent-field="agent-name">
          <label className={styles.label}>Name *</label>
          <Input
            aria-label="Name"
            ref={nameRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError("");
            }}
            placeholder="e.g. Atlas"
            validationMessage={nameError}
          />
        </div>

        <div className={styles.fieldGroup} data-agent-field="agent-role">
          <label className={styles.label}>Role</label>
          <Input
            aria-label="Role"
            value={isSuperAgent ? "SuperAgent" : role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Senior Developer"
            disabled={isSuperAgent}
          />
        </div>
      </div>

      {isSuperAgent ? <PermissionsSummary isSuperAgent /> : null}

      {restrictCreateToAuraRuntimes && simplifyForMobileCreate ? (
        <CompactEnvironmentPicker
          environment="swarm_microvm"
          setEnvironment={setEnvironment}
          allowLocal={false}
        />
      ) : restrictCreateToAuraRuntimes ? (
        <CompactEnvironmentPicker
          environment={environment}
          setEnvironment={setEnvironment}
        />
      ) : !showAdvancedRuntime ? (
        <>
          <CompactEnvironmentPicker
            environment={environment}
            setEnvironment={setEnvironment}
          />
          <button
            type="button"
            className={styles.inlineAction}
            onClick={() => setShowAdvancedRuntime(true)}
          >
            Advanced options
          </button>
        </>
      ) : (
        <>
          <div className={styles.runtimeSectionHeader}>
            <Text size="sm" weight="medium">
              Advanced
            </Text>
            <button
              type="button"
              className={styles.inlineAction}
              onClick={() => setShowAdvancedRuntime(false)}
            >
              Hide
            </button>
          </div>

          <RunsOnFields
            environment={environment}
            setEnvironment={setEnvironment}
          />

          <ListingStatusField
            listingStatus={listingStatus}
            setListingStatus={setListingStatus}
          />
        </>
      )}

      <div className={styles.fieldGroup} data-agent-field="agent-personality">
        <label className={styles.label}>Personality</label>
        <Textarea
          aria-label="Personality"
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="e.g. Thorough, opinionated, loves clean code"
          rows={2}
        />
      </div>

      <div className={styles.fieldGroup} data-agent-field="agent-system-prompt">
        <label className={styles.label}>System Prompt</label>
        <Textarea
          aria-label="System Prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Instructions and context prepended to every conversation"
          rows={4}
        />
      </div>

      {error && (
        <Text variant="muted" size="sm" className={styles.error}>
          {error}
        </Text>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advanced sub-components (used only in edit / advanced mode)
// ---------------------------------------------------------------------------

function ChoiceInfo({ hint }: { hint: string }) {
  return (
    <span
      className={styles.labelInfo}
      tabIndex={0}
      role="img"
      aria-label={hint}
      title={hint}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
        }
      }}
    >
      <Info size={12} aria-hidden="true" />
    </span>
  );
}

function ListingStatusField({
  listingStatus,
  setListingStatus,
}: {
  listingStatus: AgentListingStatus;
  setListingStatus: (v: AgentListingStatus) => void;
}) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>Visibility</label>
      <div className={styles.choiceGrid} role="radiogroup" aria-label="Visibility">
        <button
          type="button"
          role="radio"
          aria-checked={listingStatus === "closed"}
          className={`${styles.choiceCard} ${listingStatus === "closed" ? styles.choiceCardActive : ""}`}
          onClick={() => setListingStatus("closed")}
        >
          <span className={styles.choiceTitle}>
            <Lock size={14} />
            Closed
            <ChoiceInfo hint="Only you and your organization can see this agent." />
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={listingStatus === "hireable"}
          className={`${styles.choiceCard} ${listingStatus === "hireable" ? styles.choiceCardActive : ""}`}
          onClick={() => setListingStatus("hireable")}
        >
          <span className={styles.choiceTitle}>
            <Globe2 size={14} />
            Hireable
            <ChoiceInfo hint="Show this agent in the Marketplace so other users can hire it." />
          </span>
        </button>
      </div>
    </div>
  );
}

function RunsOnFields({
  environment,
  setEnvironment,
}: {
  environment: string;
  setEnvironment: (v: string) => void;
}) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>
        Runs On
        <span
          className={styles.labelInfo}
          tabIndex={0}
          role="img"
          aria-label="Isolated Cloud Runtime is the stronger boundary for sensitive workloads. The local path is the fully validated path today."
          title="Isolated Cloud Runtime is the stronger boundary for sensitive workloads. The local path is the fully validated path today."
        >
          <Info size={12} aria-hidden="true" />
        </span>
      </label>
      <div className={styles.choiceGrid}>
        <button
          type="button"
          className={`${styles.choiceCard} ${environment === "local_host" ? styles.choiceCardActive : ""}`}
          onClick={() => setEnvironment("local_host")}
        >
          <span className={styles.choiceTitle}>
            <Monitor size={14} />
            This Machine
            <ChoiceInfo hint="Run on the local host where Aura OS and your local tools are available." />
          </span>
        </button>
        <button
          type="button"
          className={`${styles.choiceCard} ${environment === "swarm_microvm" ? styles.choiceCardActive : ""}`}
          onClick={() => setEnvironment("swarm_microvm")}
        >
          <span className={styles.choiceTitle}>
            <Cloud size={14} />
            Cloud
            <ChoiceInfo hint="Use a stronger isolation boundary for Aura-managed execution." />
          </span>
        </button>
      </div>
    </div>
  );
}

function PermissionsSummary({ isSuperAgent }: { isSuperAgent: boolean }) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>Permissions</label>
      <div className={`${styles.readinessCard} ${styles.readinessInfo}`}>
        <Text size="sm">
          {isSuperAgent
            ? "CEO super-agent — full control"
            : "Standard agent — no cross-agent capabilities"}
        </Text>
        <Text size="xs" variant="muted">
          {isSuperAgent
            ? "This agent holds every capability at universe scope. Editing capabilities is not exposed in this form yet."
            : "This agent has no spawn/control permissions over other agents. A per-capability editor will land in a follow-up."}
        </Text>
      </div>
    </div>
  );
}
