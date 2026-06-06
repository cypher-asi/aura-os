import { type ReactNode } from "react";
import "./CardSection.css";

interface MetalCardProps {
  /** Span both grid columns (the wide cell) and use the wide min-height. */
  readonly wide?: boolean;
  /** Diagonal gradient angle in degrees (default 135). */
  readonly gradient?: number;
  /**
   * Media well content — a live mini-UI or image. Left empty for
   * placeholder cards, where the well simply flex-grows to push the copy
   * to the cell floor.
   */
  readonly media?: ReactNode;
  /** Small grey overline above the title (a trailing em dash is appended). */
  readonly label?: string;
  readonly title?: string;
  readonly description?: string;
  /** Copy alignment within the cell (default left). */
  readonly align?: "start" | "center";
  /** Cell-level overrides (e.g. per-instance content insets). */
  readonly className?: string;
  /** Media-well overrides. */
  readonly mediaClassName?: string;
}

/**
 * A single bento cell for `<CardSection />`: a diagonal-gradient "metal"
 * panel with a flex-grow media well on top and a bottom copy block
 * (optional overline label, title, description). The per-card gradient
 * angle is applied inline so each cell can face a different direction.
 */
export function MetalCard({
  wide = false,
  gradient = 135,
  media,
  label,
  title,
  description,
  align = "start",
  className,
  mediaClassName,
}: MetalCardProps): ReactNode {
  const cellClass = [
    "metalCard",
    wide ? "metalCardWide" : "",
    align === "center" ? "metalCardCenter" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const hasCopy = Boolean(label || title || description);
  return (
    <article
      className={cellClass}
      style={{
        background: `linear-gradient(${gradient}deg, #202020 0%, #161616 55%, #0c0c0c 100%)`,
      }}
    >
      <div
        className={
          mediaClassName ? `metalCardMedia ${mediaClassName}` : "metalCardMedia"
        }
      >
        {media}
      </div>
      {hasCopy ? (
        <div className="metalCardCopy">
          {label ? <span className="metalCardLabel">{label}</span> : null}
          {title ? <h3 className="metalCardTitle">{title}</h3> : null}
          {description ? (
            <p className="metalCardDesc">{description}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
