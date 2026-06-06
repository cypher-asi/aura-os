import { type ReactNode } from "react";
import { Section } from "../Section";
import "./CardSection.css";

interface CardSectionProps {
  /** `<MetalCard />` children that fill the bento grid. */
  readonly children: ReactNode;
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
  /** Optional extra class appended to the underlying `<Section />`. */
  readonly className?: string;
}

/**
 * Reusable marketing bento section: a compact `<Section />` whose content
 * is a full-bleed, rounded, 1px-seamed grid band holding `<MetalCard />`
 * children. Different card configurations (which card is `wide`, the
 * gradient direction, label/title vs media + copy) are expressed purely
 * through the composed children, so the same shell drives both the
 * placeholder spec bento and the personal-agent bento.
 *
 * Keeps the symmetric tight padding (`clamp(8px, 1.5vh, 20px)`) so an H2
 * `<TextCard />` intro placed directly above or below a CardSection stays
 * vertically centered card-to-card between two bentos.
 */
export function CardSection({
  children,
  ariaLabel,
  ariaLabelledBy,
  className,
}: CardSectionProps): ReactNode {
  const sectionClass = className ? `cardSection ${className}` : "cardSection";
  return (
    <Section
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
      fullHeight={false}
      className={sectionClass}
    >
      <div className="cardSectionGrid">{children}</div>
    </Section>
  );
}
