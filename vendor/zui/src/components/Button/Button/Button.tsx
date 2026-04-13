import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type CSSProperties,
} from 'react';
import clsx from 'clsx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'filled' | 'glass' | 'transparent';
export type ButtonSize = 'sm' | 'md';
export type ButtonRounded = 'none' | 'sm' | 'md' | 'lg' | 'full';
export type ButtonTextCase = 'none' | 'capitalize' | 'uppercase';

type ButtonAsButton = {
  as?: 'button';
} & ButtonHTMLAttributes<HTMLButtonElement>;

type ButtonAsSpan = {
  as: 'span';
} & HTMLAttributes<HTMLSpanElement>;

export type ButtonProps = (ButtonAsButton | ButtonAsSpan) & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Corner radius of the button.
   * @default 'md'
   */
  rounded?: ButtonRounded;
  /**
   * Text case transformation.
   * @default 'none'
   */
  textCase?: ButtonTextCase;
  iconOnly?: boolean;
  /**
   * Icon to display before the button text.
   * Typically a lucide-react icon component.
   */
  icon?: ReactNode;
  /**
   * Whether the button is in a selected/active state.
   * Useful for toggle buttons, tabs, or menu triggers.
   */
  selected?: boolean;
  /**
   * Custom background color for the selected state.
   * Accepts any valid CSS color value.
   * @default 'rgba(1, 244, 203, 0.15)'
   */
  selectedBgColor?: string;
  /**
   * When false, the button renders at full opacity even when not selected.
   * By default unselected buttons are slightly dimmed.
   * @default true
   */
  dimUnselected?: boolean;
  /**
   * All possible content states the button might display.
   * When provided, the button will size itself to fit the largest state,
   * preventing layout shifts when content changes.
   */
  contentStates?: ReactNode[];
};

export const Button = forwardRef<HTMLButtonElement | HTMLSpanElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', rounded = 'md', textCase = 'none', iconOnly = false, icon, selected = false, selectedBgColor, dimUnselected = true, className, as = 'button', contentStates, children, ...props },
    ref
  ) => {
    const classNames = clsx(
      styles.button,
      styles[variant],
      size === 'sm' && styles.sm,
      rounded !== 'md' && styles[`rounded${rounded.charAt(0).toUpperCase() + rounded.slice(1)}`],
      textCase !== 'none' && styles[textCase],
      iconOnly && styles.iconOnly,
      selected && styles.selected,
      !dimUnselected && styles.noDim,
      contentStates && styles.stableSize,
      className
    );

    const buttonStyle = selectedBgColor && selected
      ? { '--button-selected-bg': selectedBgColor } as CSSProperties
      : undefined;

    // Render content with measurement states if provided
    const content = contentStates ? (
      <>
        {/* Invisible measurement elements for all possible states */}
        <span className={styles.measurementContainer}>
          {contentStates.map((state, index) => (
            <span key={index} className={styles.measurementItem} aria-hidden="true">
              {icon}
              {state}
            </span>
          ))}
        </span>
        {/* Actual visible content */}
        <span className={styles.visibleContent}>
          {icon}
          {children}
        </span>
      </>
    ) : (
      <>
        {icon}
        {children}
      </>
    );

    if (as === 'span') {
      return (
        <span
          ref={ref as Ref<HTMLSpanElement>}
          className={classNames}
          style={buttonStyle}
          {...(props as HTMLAttributes<HTMLSpanElement>)}
        >
          {content}
        </span>
      );
    }

    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        className={classNames}
        style={buttonStyle}
        {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {content}
      </button>
    );
  }
);

Button.displayName = 'Button';
