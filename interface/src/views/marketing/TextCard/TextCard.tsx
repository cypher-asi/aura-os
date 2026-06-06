import { type ReactNode } from "react";
import "./TextCard.css";

interface TextCardProps {
  /**
   * Heading level. Drives BOTH the rendered tag (`<h1>` / `<h2>`, for
   * document semantics) and the band height: the `h1` card matches the
   * hero text band (`MarketingFirstScreen.heroBand`,
   * `clamp(280px, 50vh, 560px)`); the `h2` card is 25% shorter (75% of
   * the h1 height).
   */
  readonly level: "h1" | "h2";
  /** Heading content (string or rich node, e.g. an animated headline). */
  readonly headline: ReactNode;
  /** Optional supporting line rendered beneath the headline. */
  readonly subhead?: ReactNode;
  /**
   * Optional id forwarded to the heading so a wrapping `<Section />` can
   * point its `aria-labelledby` at it.
   */
  readonly id?: string;
  /** Optional extra class on the card band. */
  readonly className?: string;
}

/**
 * Reusable marketing text card: a vertically-centered band carrying a
 * heading and an optional subhead. Purely a sized text block (no
 * border/background) — the band height is the only thing that varies by
 * `level`, so an `h1` card and an `h2` card share the same typography
 * but reserve different vertical space.
 */
export function TextCard({
  level,
  headline,
  subhead,
  id,
  className,
}: TextCardProps): ReactNode {
  const Heading = level;
  const cardClass = [
    "textCard",
    level === "h1" ? "textCardH1" : "textCardH2",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClass}>
      <Heading id={id} className="textCardHeadline">
        {headline}
      </Heading>
      {subhead != null ? <p className="textCardSubhead">{subhead}</p> : null}
    </div>
  );
}
