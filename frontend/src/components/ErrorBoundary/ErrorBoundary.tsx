import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
  /** Optional label shown in the fallback to help identify which boundary caught the error. */
  name?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ""}]`, error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={styles.errorContainer}>
        <strong className={styles.errorHeading}>
          Something went wrong{this.props.name ? ` in ${this.props.name}` : ""}
        </strong>
        <pre className={styles.errorTrace}>
          {error.message}
        </pre>
        <button onClick={this.handleReload} className={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }
}
