import type { ReactNode } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { EmptyState } from "../EmptyState";
import styles from "./AsyncBoundary.module.css";

type AsyncBoundaryProps = {
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
  loadingMessage?: string;
  emptyIcon?: ReactNode;
  emptyMessage?: string;
  children: ReactNode;
};

export function AsyncBoundary({
  isLoading,
  isEmpty,
  error,
  loadingMessage = "Loading...",
  emptyIcon,
  emptyMessage = "Nothing here yet",
  children,
}: AsyncBoundaryProps) {
  if (isLoading) {
    return (
      <EmptyState icon={<Loader2 size={24} className={styles.spin} />}>
        {loadingMessage}
      </EmptyState>
    );
  }

  if (error) {
    return (
      <EmptyState icon={<AlertCircle size={24} />}>
        {error}
      </EmptyState>
    );
  }

  if (isEmpty) {
    return (
      <EmptyState icon={emptyIcon}>
        {emptyMessage}
      </EmptyState>
    );
  }

  return <>{children}</>;
}
