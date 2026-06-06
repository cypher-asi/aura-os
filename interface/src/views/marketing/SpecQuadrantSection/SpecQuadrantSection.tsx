import { type ReactNode } from "react";
import { CardSection, MetalCard } from "../CardSection";

/**
 * Spec bento after `ExpertiseSection` on the `/agents` page: a single
 * full-width card spanning left to right, rendered through the shared
 * `<CardSection />` / `<MetalCard />`. Copy is placeholder for now and the
 * media well is empty until an image drops in. Height comes from
 * `MetalCard` (regular 626px), matching the quadrant cards.
 */
export function SpecQuadrantSection(): ReactNode {
  return (
    <CardSection ariaLabel="Feature highlights">
      <MetalCard wide gradient={135} label="Feature one" title="Short headline here" />
    </CardSection>
  );
}
