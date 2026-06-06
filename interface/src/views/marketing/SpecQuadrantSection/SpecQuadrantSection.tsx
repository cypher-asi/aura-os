import { type ReactNode } from "react";
import { CardSection, MetalCard } from "../CardSection";

/**
 * Spec bento after `ExpertiseSection` on the `/agents` page: two cells on
 * the top row and one wide cell spanning the bottom, rendered through the
 * shared `<CardSection />` / `<MetalCard />`. Copy is placeholder for now
 * and the media wells are empty until images drop in. Card heights come
 * from `MetalCard` (regular 626px / wide 500px), matching the
 * personal-agent quadrant cards in the next section.
 */
export function SpecQuadrantSection(): ReactNode {
  return (
    <CardSection ariaLabel="Feature highlights">
      <MetalCard gradient={135} label="Feature one" title="Short headline here" />
      <MetalCard gradient={225} label="Feature two" title="Short headline here" />
      <MetalCard
        wide
        gradient={115}
        label="Feature three"
        title="Short headline here"
      />
    </CardSection>
  );
}
