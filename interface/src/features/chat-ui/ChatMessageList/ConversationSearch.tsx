import { useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import { findConversationMessages } from "./conversation-search";
import styles from "./ConversationSearch.module.css";

export function ConversationSearch({ messages, onSelect, onJumpToLatest, onLoadOlder, hasOlderMessages, isLoadingOlder }: {
  messages: readonly DisplaySessionEvent[];
  onSelect: (id: string) => void;
  onJumpToLatest?: () => void;
  onLoadOlder?: () => void;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { matches, limited } = useMemo(() => findConversationMessages(messages, open ? query : ""), [messages, open, query]);
  if (messages.length === 0) return null;
  const close = () => {
    setOpen(false);
    setQuery("");
    toggleRef.current?.focus();
  };
  return <section className={styles.root} aria-label="Conversation search">
    <button ref={toggleRef} type="button" className={styles.action}
      aria-label="Find in conversation" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Search size={15} aria-hidden="true" /> Find
    </button>
    {open ? <div className={styles.panel} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); close(); }
    }}>
      <div className={styles.controls}>
        <input autoFocus type="search" aria-label="Search this conversation"
          placeholder="Find in loaded messages…" value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !event.repeat) {
              event.preventDefault();
              if (matches[0]) onSelect(matches[0].id);
            }
          }} />
        <button type="button" className={styles.action} onClick={close} aria-label="Close conversation search"><X size={16} /></button>
      </div>
      <div className={styles.status} role="status">
        {query.trim() ? `${matches.length}${limited ? "+" : ""} matching message${matches.length === 1 ? "" : "s"}` : "Search loaded user and agent messages"}
      </div>
      <div className={styles.results}>
        {matches.map((result) => <button key={result.id} type="button" className={styles.result}
          aria-label={`${result.role === "user" ? "You" : "Agent"}: ${result.before}${result.match}${result.after}`}
          onClick={() => onSelect(result.id)}>
          <strong>{result.role === "user" ? "You" : "Agent"}: </strong>
          <span>{result.before}<mark>{result.match}</mark>{result.after}</span>
        </button>)}
      </div>
      {onJumpToLatest ? <button type="button" className={styles.action} onClick={onJumpToLatest}>Jump to latest</button> : null}
      {hasOlderMessages && onLoadOlder ? <button type="button" className={styles.action}
        disabled={isLoadingOlder} onClick={onLoadOlder}>
        {isLoadingOlder ? "Loading older messages…" : "Load older messages to search"}
      </button> : null}
    </div> : null}
  </section>;
}
