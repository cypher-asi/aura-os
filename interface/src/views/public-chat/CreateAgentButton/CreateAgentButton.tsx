import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { track } from "../../../lib/analytics";
import { useAgentOnboardingStore } from "../AgentOnboarding/agent-onboarding-store";
import styles from "./CreateAgentButton.module.css";

/**
 * Window event broadcast whenever any "Create your agent" pill is clicked.
 * The marketing `/agents` "Agents made for you" device listens for it and
 * jumps its build stepper to the final "Launch" step (100%), so clicking the
 * CTA anywhere on the page completes the on-screen build animation.
 */
export const CREATE_AGENT_CLICK_EVENT = "aura:create-agent-click";

interface CreateAgentButtonProps {
  /**
   * Optional consumer-supplied class appended to the base
   * `.ctaButton` rule. Reserved as a future hook for per-surface
   * tweaks (extra spacing, alternate hover, etc.) — there are no
   * consumers today because the shared chrome (off-white fill +
   * theme-tinted rim) already paints identically on every
   * surface, so no override is currently needed.
   *
   * Override rules should use a doubled-class selector
   * (`.myOverride.myOverride { ... }`) so they beat the base
   * `.ctaButton` specificity regardless of stylesheet import
   * order. The base styles deliberately keep specificity at
   * `(0,1,0)` so overrides only need `(0,2,0)` to win.
   */
  readonly className?: string;
  /**
   * Which public surface mounted the pill, recorded as the `source`
   * property on the `public_create_agent_clicked` event so the
   * landing→signup funnel can be split by entry point (e.g.
   * `public_chat` vs `product_hero`). Defaults to `public_landing`.
   */
  readonly source?: string;
}

/**
 * Shared "Create your agent" CTA pill — the off-white registration
 * button used on the public chat surface and related public pages.
 *
 * Originally lived inline in `PublicChatView.tsx` as `.ctaButton`.
 * Extracted into its own component so the marketing `/product`
 * hero can mount the exact same pill underneath its headline
 * without forking the styles or duplicating the click handler.
 *
 * Theming
 * -------
 * The pill body (off-white fill, dark label, shimmer sweep) is a
 * constant on every surface. ONLY the rim border and the
 * three-layer outer bloom read the active accent hue from the
 * `--public-cta-glow-color` custom property and fall back to the
 * default neon-violet (`#9b5cff`) when the property is unset.
 *   - On the public chat surface, `PublicChatView` publishes
 *     the active persona's `siteCtaGlowColor` on its `.chatView`
 *     wrapper, so the rim + bloom flip with the active tick.
 *   - On the product hero (`ProductView` / `PageHero`), no value
 *     is published so the default violet paints — which matches
 *     the spec since the product page has no persona context.
 *
 * The button always opens the agent onboarding wizard (which ends in
 * `/login?tab=register` account creation). There is no `onClick` prop
 * today because every consumer wants the same behavior; if a future
 * surface needs a custom action it can be lifted to props.
 */
export function CreateAgentButton({
  className,
  source = "public_landing",
}: CreateAgentButtonProps = {}): React.ReactElement {
  const { t } = useTranslation("publicChat");
  const buttonClassName = className
    ? `${styles.ctaButton} ${className}`
    : styles.ctaButton;
  return (
    <button
      type="button"
      className={buttonClassName}
      data-agent-surface="public-landing-cta"
      // Open the multi-step agent onboarding wizard. The wizard walks
      // the visitor through building their agent and ends in the
      // existing account-creation flow (see `AgentOnboarding`).
      onClick={() => {
        track("public_create_agent_clicked", { source });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(CREATE_AGENT_CLICK_EVENT));
        }
        useAgentOnboardingStore.getState().open(source);
      }}
    >
      <span className={styles.ctaLabel}>
        {t("createAgent.label", { defaultValue: "Create your agent" })}
      </span>
      <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
