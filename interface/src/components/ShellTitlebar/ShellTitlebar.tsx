import { type ReactNode, type HTMLAttributes } from "react";
import { Topbar } from "@cypher-asi/zui";
import { windowCommand } from "../../lib/windowCommand";
import styles from "./ShellTitlebar.module.css";

export interface ShellTitlebarProps
  extends Omit<HTMLAttributes<HTMLElement>, "children" | "title"> {
  icon?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}

/**
 * ShellTitlebar wraps the zui `Topbar` primitive with the AURA shell chrome:
 * the OS drag region, the inset rounded "pill" alignment, the frosted-blur
 * background, and a default double-click-to-maximize handler. It also owns
 * the `--shell-chrome-*` CSS custom properties so sibling chrome (e.g. the
 * BottomTaskbar pills) inherit the same height/inset/radius/background.
 *
 * Used by both `DesktopTitlebar` (authenticated shell) and `LoginView` so
 * the two surfaces share an identical shape, position, and overlay treatment.
 */
export function ShellTitlebar({
  icon,
  title,
  actions,
  className,
  onDoubleClick,
  ...rest
}: ShellTitlebarProps) {
  const composedClassName = [
    "titlebar-drag",
    styles.alignRail,
    styles.blur,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Topbar
      className={composedClassName}
      onDoubleClick={onDoubleClick ?? (() => windowCommand("maximize"))}
      icon={icon}
      title={title}
      actions={actions}
      {...rest}
    />
  );
}
