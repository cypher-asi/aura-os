import { createElement, useState } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { Bot, Briefcase } from "lucide-react";
import { formatCompact, formatCurrency } from "../../../shared/utils/format";
import { MARKETPLACE_EXPERTISE } from "../marketplace-expertise";
import type { MarketplaceAgent } from "../marketplace-types";
import styles from "./AgentTalentCard.module.css";

interface AgentTalentCardProps {
  marketplaceAgent: MarketplaceAgent;
  isSelected: boolean;
  onSelect: () => void;
  onHire: () => void;
}

function primaryExpertise(expertise: readonly string[] | undefined) {
  if (!expertise || expertise.length === 0) return null;
  return MARKETPLACE_EXPERTISE.find((e) => e.id === expertise[0]) ?? null;
}

function CoverImage({ src, name }: { src: string | null | undefined; name: string }) {
  const [broken, setBroken] = useState(false);
  const showImage = src && !broken;
  return (
    <div className={styles.cover}>
      {showImage ? (
        <img
          src={src}
          alt={name}
          className={styles.coverImage}
          onError={() => setBroken(true)}
        />
      ) : (
        <Bot size={48} className={styles.coverFallback} aria-hidden />
      )}
    </div>
  );
}

export function AgentTalentCard({
  marketplaceAgent,
  isSelected,
  onSelect,
  onHire,
}: AgentTalentCardProps) {
  const { agent, description, completed_tasks, revenue_usd } = marketplaceAgent;
  const expertise = primaryExpertise(agent.expertise);
  const roleText = agent.role.trim();
  const descriptionText = description.trim();
  const showDescription =
    descriptionText.length > 0 &&
    descriptionText.toLocaleLowerCase() !== roleText.toLocaleLowerCase();

  return (
    <article
      className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`}
      aria-label={`${agent.name} talent card`}
    >
      <button
        type="button"
        className={styles.cardBody}
        onClick={onSelect}
        aria-pressed={isSelected}
      >
        <CoverImage src={agent.icon} name={agent.name} />

        <div className={styles.info}>
          <Text size="base" weight="semibold" className={styles.name}>
            {agent.name}
          </Text>
          {expertise ? (
            <span className={styles.expertiseBadge}>
              {createElement(expertise.icon, { size: 12 })}
              <span>{expertise.label}</span>
            </span>
          ) : null}
          {roleText ? (
            <Text size="sm" variant="muted" className={styles.role}>
              {roleText}
            </Text>
          ) : null}
        </div>

        {showDescription ? (
          <Text size="sm" variant="muted" className={styles.description}>
            {descriptionText}
          </Text>
        ) : null}

        <dl className={styles.statsRow}>
          <div className={styles.stat}>
            <dt className={styles.statLabel}>
              <Briefcase size={12} /> Tasks
            </dt>
            <dd className={styles.statValue}>{formatCompact(completed_tasks)}</dd>
          </div>
          <div className={styles.stat}>
            <dt className={styles.statLabel}>Revenue</dt>
            <dd className={styles.statValue}>{formatCurrency(revenue_usd)}</dd>
          </div>
        </dl>
      </button>

      <div className={styles.footer}>
        <Button
          variant="primary"
          size="sm"
          className={styles.hireButton}
          onClick={(e) => {
            e.stopPropagation();
            onHire();
          }}
          aria-label={`Hire ${agent.name}`}
        >
          Hire
        </Button>
      </div>
    </article>
  );
}
