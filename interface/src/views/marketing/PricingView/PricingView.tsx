import { type ReactNode, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Link } from "react-router-dom";

import { CreateAgentButton } from "../../public-chat/CreateAgentButton";
import { TypewriterText } from "../../public-chat/TypewriterText";
import { PageHero } from "../PageHero";
import "./PricingView.css";

type BillingCycle = "monthly" | "yearly";

/*
 * Hoisted so the streamed `text` and the `data-text` layout-reservation
 * ghost stay byte-identical (mirrors the `/agents` + `/code` heroes). The
 * `.pricingHeadlineReserve` ::before mirrors this string so the description +
 * CTA below the headline don't shift as characters type in.
 */
const HERO_HEADLINE = "Starting at free.";

interface Plan {
  readonly name: string;
  readonly monthlyPrice: string;
  readonly yearlyPrice: string;
  readonly description: string;
  readonly features: readonly ReactNode[];
  readonly ctaLabel: string;
  readonly href: string;
  readonly recommended?: boolean;
  readonly priceNote?: string;
}

const PLANS: readonly Plan[] = [
  {
    name: "Free",
    monthlyPrice: "$0",
    yearlyPrice: "$0",
    description: "Get started for free:",
    features: [
      "No credit card required",
      "Local open source models",
      "Pay-as-you-go for frontier models",
    ],
    ctaLabel: "Download",
    href: "/download",
  },
  {
    name: "Pro",
    monthlyPrice: "$20",
    yearlyPrice: "$192",
    priceNote: "$10/mo for Zero Pro OG subscribers",
    description: "Everything in Free, plus:",
    features: ["$20 worth of monthly credits", "Remote agents"],
    ctaLabel: "Download",
    href: "/download",
  },
  {
    name: "Sage",
    monthlyPrice: "$200",
    yearlyPrice: "$1,920",
    description: "Everything in Pro, plus:",
    features: [
      "20x usage on frontier models",
      "Priority access to new features",
    ],
    ctaLabel: "Download",
    href: "/download",
  },
] as const;

/**
 * Marketing `/pricing` page. Ported from
 * `aura-web/src/app/pricing/page.tsx`. The page chrome (public-mode
 * `AuraShell` + `PublicMarketingPanel` scroll column) is owned by the
 * parent route; the page itself is just the pricing section.
 */
export function PricingView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Pricing";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const cadenceLabel = billingCycle === "monthly" ? "/mo." : "/yr.";

  return (
    <section className="pricingPage">
      <div className="pricingPageContent">
        <div className="pricingHeroBand">
          <PageHero
            centered
            preview={null}
            headline={
              <span className="pricingHeadlineReserve" data-text={HERO_HEADLINE}>
                <TypewriterText
                  text={HERO_HEADLINE}
                  speedMs={45}
                  showCaret={false}
                />
              </span>
            }
            description="Start with local open source models for free, then pay only for the frontier models you use."
            headlineCta={<CreateAgentButton source="pricing_hero" />}
          />
        </div>

        <div className="pricingPlansSection">
          <div className="pricingPlansSectionHeader">
            <p className="pricingPlansLabel">Individual Plans</p>
            <div
              className="pricingToggle"
              role="tablist"
              aria-label="Billing cycle"
            >
              <button
                type="button"
                role="tab"
                aria-selected={billingCycle === "monthly"}
                className={`pricingToggleButton${billingCycle === "monthly" ? " pricingToggleButtonActive" : ""}`}
                onClick={() => setBillingCycle("monthly")}
              >
                Monthly
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={billingCycle === "yearly"}
                className={`pricingToggleButton${billingCycle === "yearly" ? " pricingToggleButtonActive" : ""}`}
                onClick={() => setBillingCycle("yearly")}
              >
                Yearly
              </button>
            </div>
          </div>
          <div className="pricingPlansGrid">
            {PLANS.map((plan) => {
              const price =
                billingCycle === "monthly"
                  ? plan.monthlyPrice
                  : plan.yearlyPrice;

              return (
                <article
                  key={plan.name}
                  className={`pricingPlanCard${plan.recommended ? " pricingPlanCardRecommended" : ""}`}
                >
                  <div className="pricingPlanBody">
                    <div className="pricingPlanHeading">
                      <div className="pricingPlanTitleRow">
                        <h2 className="pricingPlanTitle">{plan.name}</h2>
                      </div>
                      <p className="pricingPlanPrice">
                        <span className="pricingPlanPriceValue">{price}</span>
                        {price !== "Free" && (
                          <span className="pricingPlanPriceCadence">
                            {cadenceLabel}
                          </span>
                        )}
                      </p>
                      {plan.priceNote && (
                        <p className="pricingPlanPriceNote">{plan.priceNote}</p>
                      )}
                      <p className="pricingPlanDescription">
                        {plan.description}
                      </p>
                    </div>

                    <ul className="pricingPlanFeatureList">
                      {plan.features.map((feature, index) => (
                        <li
                          key={`${plan.name}-${index}`}
                          className="pricingPlanFeature"
                        >
                          <Check
                            size={15}
                            strokeWidth={2}
                            className="pricingPlanFeatureIcon"
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Link
                    to={plan.href}
                    className={`pricingPlanButton${plan.recommended ? " pricingPlanButtonPrimary" : ""}`}
                  >
                    {plan.ctaLabel}
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}