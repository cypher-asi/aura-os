import { useCallback, useRef, useState } from "react";
import { Button, Input, Modal, Spinner } from "@cypher-asi/zui";
import { Search } from "lucide-react";
import { api } from "../../../../api/client";
import type { RecallSearchResult } from "../../../../shared/api/agents";
import styles from "./RecallModal.module.css";

interface RecallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSource: (result: RecallSearchResult) => void;
  onAddToDraft: (result: RecallSearchResult) => void;
  canAddToDraft: boolean;
  resolveMetadata: (result: RecallSearchResult) => RecallResultMetadata;
}

export interface RecallResultMetadata {
  sessionTitle: string;
  projectName: string;
  agentName: string;
}

/**
 * Search is intentionally a separate modal rather than a hidden chat action:
 * each result has separate, explicit actions to open its source transcript or
 * add the bounded, cited excerpt to an existing draft. Nothing is auto-sent.
 */
export function RecallModal({
  isOpen,
  onClose,
  onOpenSource,
  onAddToDraft,
  canAddToDraft,
  resolveMetadata,
}: RecallModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecallSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [skippedSessions, setSkippedSessions] = useState(0);
  const requestIdRef = useRef(0);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setQuery("");
    setResults([]);
    setLoading(false);
    setError(null);
    setSearched(false);
    setSkippedSessions(0);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const openSource = useCallback((result: RecallSearchResult) => {
    reset();
    onOpenSource(result);
  }, [onOpenSource, reset]);

  const addToDraft = useCallback((result: RecallSearchResult) => {
    reset();
    onAddToDraft(result);
  }, [onAddToDraft, reset]);

  const submit = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Enter at least two characters to search past chats.");
      return;
    }
    setLoading(true);
    setError(null);
    setSearched(true);
    setResults([]);
    setSkippedSessions(0);
    const requestId = ++requestIdRef.current;
    try {
      const response = await api.searchMySessionHistory(trimmed);
      if (requestId !== requestIdRef.current) return;
      setResults(response.results);
      setSkippedSessions(response.skippedSessions);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setResults([]);
      setError(cause instanceof Error ? cause.message : "Could not search past chats.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [query]);

  return (
    <Modal isOpen={isOpen} onClose={close} title="Recall past chats" size="md">
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className={styles.explainer}>
          Search completed chats. Open the original source or add a cited excerpt to your draft; nothing is sent automatically.
        </p>
        <div className={styles.searchRow}>
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Why did we change authentication refresh?"
            aria-label="Search completed chats"
          />
          <Button type="submit" size="sm" disabled={loading} aria-label="Search past chats">
            {loading ? <Spinner size="sm" /> : <Search size={14} />}
            Search
          </Button>
        </div>
      </form>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {skippedSessions > 0 ? (
        <p className={styles.warning} role="status">
          Some chats couldn&apos;t be searched. Results may be incomplete.
        </p>
      ) : null}
      {searched && !loading && !error && results.length === 0 ? (
        <p className={styles.empty}>No matching completed chats found.</p>
      ) : null}
      <div className={styles.results} aria-live="polite">
        {results.map((result) => {
          const metadata = resolveMetadata(result);
          return (
            <article
              key={`${result.sessionId}:${result.eventId}`}
              className={styles.result}
              data-recall-event-id={result.eventId}
            >
              <span className={styles.title}>{metadata.sessionTitle}</span>
              <span className={styles.meta}>
                {metadata.projectName} · {metadata.agentName} · {result.role === "assistant" ? "Assistant" : "You"} · {new Date(result.occurredAt).toLocaleString()}
              </span>
              <span className={styles.snippet}>{result.snippet}</span>
              <span className={styles.source}>Source event {result.eventId.slice(0, 8)}</span>
              <span className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => openSource(result)}
                >
                  Open source chat
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  disabled={!canAddToDraft}
                  title={canAddToDraft ? "Add this evidence to the current draft" : "Open a chat before adding evidence"}
                  onClick={() => addToDraft(result)}
                >
                  Add to current draft
                </button>
              </span>
            </article>
          );
        })}
      </div>
    </Modal>
  );
}
