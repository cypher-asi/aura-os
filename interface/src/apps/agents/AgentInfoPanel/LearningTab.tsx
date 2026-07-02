import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Text } from "@cypher-asi/zui";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCw,
  SearchCheck,
  X,
} from "lucide-react";
import { api } from "../../../api/client";
import type {
  Agent,
  AgentImprovementProposal,
  AgentSelfImprovementConfig,
  AgentSelfImprovementMode,
} from "../../../shared/types";
import { getApiErrorMessage } from "../../../shared/utils/api-errors";
import styles from "./LearningTab.module.css";

interface LearningTabProps {
  agent: Agent;
  isOwnAgent: boolean;
}

const DEFAULT_CONFIG: AgentSelfImprovementConfig = {
  mode: "off",
  allow_memory: true,
  allow_skills: true,
  allow_background_review: false,
};

const KIND_LABELS: Record<AgentImprovementProposal["kind"], string> = {
  memory_fact: "Memory fact",
  memory_procedure: "Procedure",
  skill_create: "New skill",
  skill_update: "Skill update",
};

const STATUS_LABELS: Record<AgentImprovementProposal["status"], string> = {
  pending: "Pending",
  applied: "Applied",
  rejected: "Rejected",
  failed: "Failed",
};

const SOURCE_LABELS: Record<AgentImprovementProposal["provenance"]["source"], string> = {
  agent_tool: "Agent proposal",
  learning_review: "Learning review",
};

function payloadPreview(payload: AgentImprovementProposal["payload"]): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function sortProposals(proposals: AgentImprovementProposal[]) {
  return [...proposals].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}

export function LearningTab({ agent, isOwnAgent }: LearningTabProps) {
  const [config, setConfig] = useState<AgentSelfImprovementConfig>(DEFAULT_CONFIG);
  const [proposals, setProposals] = useState<AgentImprovementProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewSummary, setReviewSummary] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const agentId = agent.agent_id;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextConfig, nextProposals] = await Promise.all([
        api.agentImprovements.getConfig(agentId),
        api.agentImprovements.list(agentId),
      ]);
      setConfig(nextConfig);
      setProposals(sortProposals(nextProposals));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const pendingCount = useMemo(
    () => proposals.filter((proposal) => proposal.status === "pending").length,
    [proposals],
  );
  const activeProposals = useMemo(
    () =>
      proposals.filter(
        (proposal) => proposal.status === "pending" || proposal.status === "failed",
      ),
    [proposals],
  );
  const resolvedProposals = useMemo(
    () =>
      proposals.filter(
        (proposal) => proposal.status === "applied" || proposal.status === "rejected",
      ),
    [proposals],
  );
  const failedCount = useMemo(
    () => proposals.filter((proposal) => proposal.status === "failed").length,
    [proposals],
  );

  const updateConfig = useCallback(
    async (patch: Partial<AgentSelfImprovementConfig>) => {
      if (!isOwnAgent) return;
      const next = { ...config, ...patch };
      setSaving(true);
      setError(null);
      setReviewSummary(null);
      try {
        const saved = await api.agentImprovements.updateConfig(agentId, next);
        setConfig(saved);
      } catch (err) {
        setError(getApiErrorMessage(err));
      } finally {
        setSaving(false);
      }
    },
    [agentId, config, isOwnAgent],
  );

  const setMode = (mode: AgentSelfImprovementMode) => {
    void updateConfig({ mode });
  };

  const applyProposal = async (proposalId: string) => {
    setActionId(proposalId);
    setError(null);
    setReviewSummary(null);
    try {
      const updated = await api.agentImprovements.apply(agentId, proposalId);
      setProposals((current) =>
        sortProposals(current.map((p) => (p.id === updated.id ? updated : p))),
      );
    } catch (err) {
      setError(getApiErrorMessage(err));
      await fetchData();
    } finally {
      setActionId(null);
    }
  };

  const rejectProposal = async (proposalId: string) => {
    setActionId(proposalId);
    setError(null);
    setReviewSummary(null);
    try {
      const updated = await api.agentImprovements.reject(agentId, proposalId);
      setProposals((current) =>
        sortProposals(current.map((p) => (p.id === updated.id ? updated : p))),
      );
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setActionId(null);
    }
  };

  const runLearningReview = async () => {
    if (!isOwnAgent || config.mode === "off" || !config.allow_background_review) return;
    setReviewing(true);
    setError(null);
    setReviewSummary(null);
    try {
      const result = await api.agentImprovements.review(agentId);
      setProposals((current) => sortProposals([...result.proposals, ...current]));
      const suffix = result.limit_reached ? " Queue limit reached." : "";
      setReviewSummary(
        `Reviewed ${result.scanned_sessions} sessions and created ${result.created_proposals} proposals.${suffix}`,
      );
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setReviewing(false);
    }
  };

  const renderProposal = (proposal: AgentImprovementProposal) => {
    const busy = actionId === proposal.id;
    const actionable =
      isOwnAgent &&
      (proposal.status === "pending" || proposal.status === "failed");
    const source = proposal.provenance?.source ?? "agent_tool";
    const evidence = proposal.evidence ?? [];
    return (
      <article key={proposal.id} className={styles.proposalRow}>
        <div className={styles.proposalMain}>
          <div className={styles.proposalTopline}>
            <span className={styles.kind}>{KIND_LABELS[proposal.kind]}</span>
            <span className={styles.status} data-status={proposal.status}>
              {STATUS_LABELS[proposal.status]}
            </span>
          </div>
          <Text size="sm" weight="medium" className={styles.title}>
            {proposal.title}
          </Text>
          <div className={styles.metaRow}>
            <span>{SOURCE_LABELS[source]}</span>
            {proposal.source_session_id && (
              <span>Session {proposal.source_session_id.slice(0, 8)}</span>
            )}
          </div>
          <Text size="xs" className={styles.rationale}>
            {proposal.rationale}
          </Text>
          {evidence.length > 0 && (
            <div className={styles.evidenceList}>
              {evidence.slice(0, 2).map((item, index) => (
                <blockquote
                  key={`${proposal.id}-evidence-${item.event_id ?? index}`}
                  className={styles.evidence}
                >
                  {item.quote}
                </blockquote>
              ))}
            </div>
          )}
          {proposal.error && (
            <Text size="xs" className={styles.error}>
              {proposal.error}
            </Text>
          )}
          <pre className={styles.payload}>{payloadPreview(proposal.payload)}</pre>
        </div>
        {actionable && (
          <div className={styles.proposalActions}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void rejectProposal(proposal.id)}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={13} className={styles.spin} />
              ) : (
                <X size={13} />
              )}
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => void applyProposal(proposal.id)}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={13} className={styles.spin} />
              ) : (
                <Check size={13} />
              )}
              Apply
            </Button>
          </div>
        )}
      </article>
    );
  };

  if (loading) {
    return (
      <div className={styles.emptyState}>
        <Loader2 size={14} className={styles.spin} />
        Loading learning state...
      </div>
    );
  }

  return (
    <div className={styles.learningTab}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <Text size="sm" weight="semibold">Self-improvement</Text>
            <Text size="xs" className={styles.muted}>
              {config.mode === "propose" ? "Proposal mode" : "Disabled"}
            </Text>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => void fetchData()}
            title="Refresh"
          >
            <RotateCw size={14} />
          </button>
        </div>

        <div className={styles.segmented} aria-label="Self-improvement mode">
          <button
            type="button"
            className={config.mode === "off" ? styles.segmentActive : styles.segment}
            onClick={() => setMode("off")}
            disabled={!isOwnAgent || saving}
          >
            Off
          </button>
          <button
            type="button"
            className={config.mode === "propose" ? styles.segmentActive : styles.segment}
            onClick={() => setMode("propose")}
            disabled={!isOwnAgent || saving}
          >
            Propose
          </button>
        </div>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={config.allow_memory}
            disabled={!isOwnAgent || saving || config.mode === "off"}
            onChange={(event) => {
              void updateConfig({ allow_memory: event.currentTarget.checked });
            }}
          />
          <span>Memory</span>
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={config.allow_skills}
            disabled={!isOwnAgent || saving || config.mode === "off"}
            onChange={(event) => {
              void updateConfig({ allow_skills: event.currentTarget.checked });
            }}
          />
          <span>Skills</span>
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={config.allow_background_review}
            disabled={!isOwnAgent || saving || config.mode === "off"}
            onChange={(event) => {
              void updateConfig({ allow_background_review: event.currentTarget.checked });
            }}
          />
          <span>Review sessions</span>
        </label>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void runLearningReview()}
          disabled={
            !isOwnAgent ||
            reviewing ||
            saving ||
            config.mode === "off" ||
            !config.allow_background_review
          }
        >
          {reviewing ? (
            <Loader2 size={13} className={styles.spin} />
          ) : (
            <SearchCheck size={13} />
          )}
          Review
        </Button>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <Text size="sm" weight="semibold">Improvement queue</Text>
            <Text size="xs" className={styles.muted}>
              {pendingCount} pending
              {failedCount > 0 ? `, ${failedCount} failed` : ""}
            </Text>
          </div>
        </div>

        {error && (
          <Text size="xs" className={styles.error} role="alert">
            {error}
          </Text>
        )}
        {reviewSummary && (
          <Text size="xs" className={styles.reviewSummary}>
            {reviewSummary}
          </Text>
        )}

        {activeProposals.length === 0 ? (
          <div className={styles.emptyState}>No pending proposals</div>
        ) : (
          <div className={styles.proposalList}>
            {activeProposals.map(renderProposal)}
          </div>
        )}

        {resolvedProposals.length > 0 && (
          <div className={styles.historySection}>
            <button
              type="button"
              className={styles.historyToggle}
              onClick={() => setShowHistory((value) => !value)}
              aria-expanded={showHistory}
            >
              {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>History</span>
              <span className={styles.historyCount}>
                {resolvedProposals.length} resolved
              </span>
            </button>
            {showHistory && (
              <div className={styles.proposalList}>
                {resolvedProposals.map(renderProposal)}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
