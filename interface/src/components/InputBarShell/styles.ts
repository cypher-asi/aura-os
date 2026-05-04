import styles from "./InputBarShell.module.css";

/**
 * Shared CSS module classes for the input bar primitives.
 *
 * Re-exported here (separate from the component module) so apps that
 * compose `InputBarShell` slots can apply the same chrome to their
 * slot content (attach button, model menu items, etc.) without
 * tripping the React-Refresh "components-only export" rule.
 */
export const inputBarShellStyles = styles;
