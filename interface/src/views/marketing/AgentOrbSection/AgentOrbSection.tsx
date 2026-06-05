import { type ReactNode } from "react";
import { AgentMarquee } from "../AgentMarquee";
import { AuraOrb } from "../AuraOrb";
import styles from "./AgentOrbSection.module.css";

/**
 * Standalone agents showcase that used to live inside the `/agents`
 * hero stage: the procedural WebGL orb (`<AuraOrb />`, a fragment-
 * shader recreation of the legacy `AURA_visual_loop.mp4`) with the
 * looping `<AgentMarquee />` agent cards overlaid on top. It now sits
 * directly below `AgentChatSection` as its own full-bleed band.
 *
 * The orb + marquee placement rules (a self-contained stage container
 * with a definite height, the orb clip/mask, the card-row offset) are
 * ported verbatim from the former `ProductView` orb stage so the
 * visual reads identically — only the mounting location changed.
 */
export function AgentOrbSection(): ReactNode {
  return (
    <section className={styles.orbSection}>
      <div className={styles.orbStage}>
        <div className={styles.orb}>
          <div className={styles.orbVideoClip} aria-hidden="true">
            <AuraOrb className={styles.orbVideo} />
          </div>
          <div className={styles.orbMarquee}>
            <AgentMarquee />
          </div>
        </div>
      </div>
    </section>
  );
}
