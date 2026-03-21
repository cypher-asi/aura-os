import { Component, type ErrorInfo, type ReactNode } from "react";

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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: "var(--space-4, 16px)",
          gap: "var(--space-3, 12px)",
          color: "var(--color-text-muted, #888)",
          textAlign: "center",
          overflow: "auto",
        }}
      >
        <strong style={{ color: "var(--color-danger, #e55)" }}>
          Something went wrong{this.props.name ? ` in ${this.props.name}` : ""}
        </strong>
        <pre
          style={{
            fontSize: 11,
            maxWidth: "100%",
            maxHeight: 200,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "rgba(255,255,255,0.04)",
            padding: "8px 12px",
            borderRadius: 4,
          }}
        >
          {error.message}
        </pre>
        <button
          onClick={this.handleReload}
          style={{
            padding: "6px 16px",
            border: "1px solid var(--color-border, #333)",
            borderRadius: 4,
            background: "transparent",
            color: "var(--color-text, #ccc)",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}
