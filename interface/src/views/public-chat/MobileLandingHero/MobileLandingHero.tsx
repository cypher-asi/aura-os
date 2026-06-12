import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { CreateAgentButton } from "../CreateAgentButton";
import { TypewriterText } from "../TypewriterText";
import type { Persona } from "../personas";
import styles from "./MobileLandingHero.module.css";

/**
 * Mobile public landing hero.
 *
 * The mobile counterpart of the desktop `PublicChatView` hero —
 * intentionally lighter: it pins ONE persona (the Creator, the same
 * default the desktop carousel opens on) as a static portrait card
 * instead of mounting the `MockAuraApp` mock desktop, the WebGL site
 * backgrounds, or the `PersonaTickRail` carousel. Scrolling past the
 * hero moves straight into the embedded `/agents` section stack
 * (mounted by `MobilePublicChatView`), so the landing story matches
 * desktop — hero, then the agents flow — with none of the heavy
 * decorative machinery on a phone's budget.
 *
 * Same looping typewriter tagline (and i18n keys) as the desktop
 * hero, the shared `CreateAgentButton` CTA, and a `children` slot
 * for the composer the parent owns.
 */

// Mirrors `HERO_PHRASES` in `PublicChatView.tsx` (same i18n keys under
// `chat.heroPhrases.*`) so desktop and mobile cycle identical copy.
// The first/longest entry doubles as the headline's `data-text` width
// reserve so the centered box never reflows as phrases stream.
const HERO_PHRASES = [
  "Your private agent.",
  "Build anything.",
  "Imagine anything.",
  "Code anything.",
  "Just by chatting.",
] as const;

interface MobileLandingHeroProps {
  /** Persona painted in the portrait card (the Creator on `/`). */
  readonly persona: Persona;
  /** Composer slot rendered between the portrait and the CTA. */
  readonly children?: ReactNode;
}

export function MobileLandingHero({
  persona,
  children,
}: MobileLandingHeroProps): React.ReactElement {
  const { t } = useTranslation("publicChat");

  const heroHeadline = t("chat.heroPhrases.privateAgent", {
    defaultValue: "Your private agent.",
  });
  const heroPhrases = useMemo(
    () =>
      HERO_PHRASES.map((phrase, index) =>
        t(`chat.heroPhrases.${index}`, { defaultValue: phrase }),
      ),
    [t],
  );

  const portraitUrl = persona.theme.desktopBackgroundUrl;
  const portraitVideoUrl = persona.theme.desktopBackgroundVideoUrl ?? null;
  const portraitObjectPosition =
    persona.theme.avatarObjectPosition ?? "50% 25%";

  return (
    <section
      className={styles.hero}
      data-persona-id={persona.id}
      data-testid="mobile-landing-hero"
    >
      {/* Headline zone — grows to fill the space between the shell
          topbar and the portrait card so the tagline sits vertically
          centered above the card. */}
      <div className={styles.headlineZone}>
        <h1
          className={styles.headline}
          data-text={heroHeadline}
          style={{ color: persona.theme.heroHeadlineColor ?? undefined }}
        >
          <TypewriterText
            text={heroHeadline}
            phrases={heroPhrases}
            speedMs={45}
          />
        </h1>
      </div>

      {portraitUrl ? (
        <figure className={styles.portraitCard}>
          {portraitVideoUrl ? (
            <video
              className={styles.portraitImage}
              src={portraitVideoUrl}
              poster={portraitUrl}
              autoPlay
              loop
              muted
              playsInline
              aria-hidden="true"
              style={{
                backgroundColor:
                  persona.theme.desktopBackgroundColor ?? undefined,
                objectPosition: portraitObjectPosition,
              }}
              data-testid="mobile-landing-hero-video"
            />
          ) : (
            <img
              src={portraitUrl}
              alt={t("mobileChat.personaPortraitAlt", {
                defaultValue: `${persona.name} agent portrait`,
                name: persona.name,
              })}
              className={styles.portraitImage}
              style={{
                backgroundColor:
                  persona.theme.desktopBackgroundColor ?? undefined,
                objectPosition: portraitObjectPosition,
              }}
              draggable={false}
              decoding="async"
              fetchPriority="high"
            />
          )}
        </figure>
      ) : null}

      {children}

      {/* CTA zone — mirrors the headline zone, growing to fill the
          space between the card and the bottom of the shell so the
          "Create your agent" pill sits vertically centered below the
          card. */}
      <div className={styles.ctaZone}>
        <div className={styles.ctaSlot}>
          <CreateAgentButton source="public_chat_mobile" />
        </div>
      </div>

      <div className={styles.scrollHint} aria-hidden="true">
        <ChevronDown size={22} strokeWidth={2.5} />
      </div>
    </section>
  );
}
