import { type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { PERSONAS, type Persona } from "../../public-chat/personas";
import styles from "./AgentMarquee.module.css";

/**
 * Horizontally looping row of agent cards rendered as the
 * `videoOverlay` slot on the product page hero. Sits over the
 * vertical center of `/AURA_visual_loop.mp4` so the cards slide
 * across the bright orb in the looping background video.
 *
 * Loop strategy
 * -------------
 * The flex `track` contains TWO copies of `PERSONAS` rendered
 * back-to-back. A `@keyframes` rule translates the track from
 * `0` to `-50%` over a fixed duration; once the second copy has
 * shifted into the position the first copy started in, the
 * animation snaps back to `0` and the visitor never sees a seam.
 * Duplicating the list in DOM is cheap (12 nodes total today)
 * and keeps the loop pure CSS, so no JS scheduler runs while the
 * marquee is on screen.
 *
 * Hover semantics
 * ---------------
 * - `:hover` (or `:focus-within`) on the marquee container pauses
 *   the track via `animation-play-state: paused`. A visitor who
 *   parks the cursor anywhere on the strip — including the gaps
 *   between cards — freezes the loop, matching the reference
 *   design where the row stops the moment a viewer engages.
 * - `:hover` (or `:focus-visible`) on a single card scales it up
 *   and fades in the bottom-left "Name / Role" caption overlay,
 *   giving the focused agent a brief poster moment. `z-index` is
 *   bumped on the active card so the scaled-up edges paint above
 *   neighboring cards instead of being clipped by them.
 *
 * Accessibility
 * -------------
 * - Each card is keyboard-focusable (`tabIndex={0}`) with
 *   `role="img"` + `aria-label="Name, Role"` so the strip
 *   announces both labels to screen readers without exposing a
 *   non-functional button (clicking the card is a deliberate
 *   no-op for now per the product brief).
 * - `prefers-reduced-motion: reduce` is intentionally NOT honoured
 *   for the scroll itself (the strip is the page hero's load-bearing
 *   motion); hovering or focusing the strip pauses it. See the
 *   rationale comment in `AgentMarquee.module.css`.
 *
 * The component reads `PERSONAS` directly because the product
 * page's marquee always shows the canonical roster. If a future
 * surface needs a custom subset, hoisting `agents` into a prop
 * is a one-line change.
 */
export function AgentMarquee(): ReactElement {
  const { t } = useTranslation("marketing");
  // Render the persona list TWICE so the CSS `translateX(-50%)`
  // keyframe slides the second copy into the position the first
  // copy started in for a seamless wrap. The `${persona.id}-${i}`
  // composite key keeps React's reconciler happy even though each
  // persona id appears in the array twice.
  const cards = [...PERSONAS, ...PERSONAS];

  return (
    <div
      className={styles.marquee}
      data-testid="agent-marquee"
      aria-label={t("agentMarquee.ariaLabel", { defaultValue: "AURA agents" })}
    >
      <div className={styles.track}>
        {cards.map((persona, index) => (
          <AgentCard
            key={`${persona.id}-${index}`}
            persona={persona}
          />
        ))}
      </div>
    </div>
  );
}

interface AgentCardProps {
  readonly persona: Persona;
}

function AgentCard({ persona }: AgentCardProps): ReactElement {
  const { t } = useTranslation("marketing");
  const { theme } = persona;
  const personaName = t(`personas.${persona.id}.name`, {
    defaultValue: persona.name,
  });
  const personaRole = t(`personas.${persona.id}.role`, {
    defaultValue: persona.role,
  });
  // Reuse the persona's avatar crop hint (a `background-position`
  // string already tuned to land the head/face inside the 18px
  // dock circle in `MockAuraApp`). The marquee card has a similar
  // task — frame the head + shoulders inside a portrait card —
  // so the same crop hint is the right starting point. Falls
  // back to the dock's default upper-third slice when the persona
  // doesn't override it.
  const objectPosition = theme.avatarObjectPosition ?? "50% 18%";

  return (
    <div
      className={styles.card}
      data-persona-id={persona.id}
      role="img"
      aria-label={`${personaName}, ${personaRole}`}
      tabIndex={0}
    >
      {theme.desktopBackgroundUrl ? (
        <img
          className={styles.portrait}
          src={theme.desktopBackgroundUrl}
          alt=""
          draggable={false}
          loading="lazy"
          style={{ objectPosition }}
        />
      ) : (
        // Defensive fallback: every curated persona today ships a
        // `desktopBackgroundUrl`, but the type allows `null` so
        // future no-portrait personas don't crash the marquee. The
        // initial-letter chip mirrors the public chat's no-theme
        // avatar treatment for visual consistency.
        <div className={styles.portraitFallback} aria-hidden="true">
          {personaName.charAt(0)}
        </div>
      )}
      <div className={styles.caption}>
        <div className={styles.captionName}>{personaName}</div>
        <div className={styles.captionRole}>{personaRole}</div>
      </div>
    </div>
  );
}
