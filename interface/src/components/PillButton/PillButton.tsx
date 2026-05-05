import { forwardRef } from "react";
import { Button, type ButtonProps } from "@cypher-asi/zui";
import styles from "./PillButton.module.css";

/**
 * zui's `ButtonProps` is a discriminated union of `as: 'button'` and
 * `as: 'span'`. We only render as a `<button>`, so we narrow to that branch
 * via `Extract` — otherwise common DOM props like `disabled` aren't visible
 * to consumers (they only exist on the button branch of the union).
 */
type ZuiButtonOnlyProps = Extract<ButtonProps, { as?: "button" }>;

export type PillButtonProps = Omit<
  ZuiButtonOnlyProps,
  "variant" | "rounded" | "as"
>;

/**
 * PillButton renders a fully-rounded, accent-colored button with always-dark
 * text. It wraps the zui `Button` `filled` variant and locks the shape so
 * every shell that wants an accent call-to-action (titlebar update prompt,
 * login CTAs, etc.) shares the same affordance.
 *
 * Notes:
 * - zui's `--radius-full` token resolves to `0` in this project, so the pill
 *   shape is enforced via an explicit `9999px` radius in the local CSS module
 *   rather than relying on `rounded="full"`.
 * - Text color is hard-pinned to a dark value so the pill stays legible
 *   regardless of accent (some accents like purple/blue/rose otherwise
 *   resolve `--color-accent-contrast` to white).
 */
export const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  ({ className, ...rest }, ref) => {
    const composedClassName = [styles.pillButton, className]
      .filter(Boolean)
      .join(" ");

    return (
      <Button
        ref={ref}
        variant="filled"
        className={composedClassName}
        {...rest}
      />
    );
  },
);

PillButton.displayName = "PillButton";
