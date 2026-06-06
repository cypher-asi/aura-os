import { type ReactNode } from "react";
import { CardSection, MetalCard } from "../CardSection";
import { NoiseReductionCard } from "./NoiseReductionCard";
import "./SpecQuadrantSection.css";

/**
 * Spec bento after `ExpertiseSection` on the `/agents` page: a single
 * full-width card spanning left to right, rendered through the shared
 * `<CardSection />` / `<MetalCard />`. The media well hosts the static
 * `NoiseReductionCard` plugin mini-UI (centered via `specQuadCard`); the
 * card has no bottom copy block since the device carries its own caption
 * (STRENGTH / DEEP LEARNING NOISE REDUCTION). Height comes from `MetalCard`
 * (regular 626px), matching the quadrant cards.
 */
export function SpecQuadrantSection(): ReactNode {
  return (
    <CardSection ariaLabel="Feature highlights">
      <MetalCard
        wide
        gradient={135}
        align="center"
        className="specQuadCard"
        media={<NoiseReductionCard />}
      />
    </CardSection>
  );
}
