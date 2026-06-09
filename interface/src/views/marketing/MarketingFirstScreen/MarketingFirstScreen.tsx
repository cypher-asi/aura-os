import { type ReactNode } from "react";
import styles from "./MarketingFirstScreen.module.css";

interface MarketingFirstScreenProps {
  /**
   * Hero copy block — typically a `<PageHero centered .../>`. Rendered
   * inside the vertically-centered `.heroBand`, whose shared height
   * fixes the hero text's on-screen location identically across pages.
   */
  readonly hero: ReactNode;
  /**
   * Large first-screen content placed in the stage below the hero
   * band (the orb video + agent marquee on `/agents`). The stage's
   * shared height/start guarantees this content begins at the same
   * vertical position on every page. Optional: `/code` omits it and
   * lets its own `CardSection` mock-desktop card follow the band, so
   * the card starts where the `/agents` stage does (the band height
   * is the shared anchor).
   */
  readonly stage?: ReactNode;
  /**
   * Optional class appended to the stage so a consuming view can layer
   * on content-specific sizing (e.g. the mock desktop's container-
   * query footprint, the orb video placement) without forking the
   * shared layout.
   */
  readonly stageClassName?: string;
  /**
   * When true, marks the stage `aria-hidden`. Used by `/code`, whose
   * mock desktop is purely decorative. Left false on `/agents`, where
   * the agent cards carry per-card `aria-label`s that must stay
   * exposed to assistive tech.
   */
  readonly stageHidden?: boolean;
}

/**
 * Shared first-screen layout for the public marketing pages: a
 * vertically-centered hero text band stacked above a large content
 * stage. Both `/code` (`CodeView`) and `/agents` (`ProductView`)
 * render through this so their hero text lands in the same band and
 * their stage content (mock desktop vs. agent cards) starts at the
 * same vertical position. The alignment-critical heights live in
 * `MarketingFirstScreen.module.css`.
 */
export function MarketingFirstScreen({
  hero,
  stage,
  stageClassName,
  stageHidden = false,
}: MarketingFirstScreenProps): ReactNode {
  const stageClass = stageClassName
    ? `${styles.stage} ${stageClassName}`
    : styles.stage;

  const rootClass = stage
    ? styles.firstScreen
    : `${styles.firstScreen} ${styles.firstScreenNoStage}`;

  return (
    <div className={rootClass}>
      <div className={styles.heroBand}>{hero}</div>
      {stage ? (
        <div className={stageClass} aria-hidden={stageHidden || undefined}>
          {stage}
        </div>
      ) : null}
    </div>
  );
}
