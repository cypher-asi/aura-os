import { useCallback, useMemo } from "react";
import { X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePublicChatStore } from "../../../stores/public-chat-store";
import styles from "./PublicSessionsPanel.module.css";

interface PublicSessionsPanelProps {
  /**
   * Free-text filter applied to the rendered sessions. Owned by the
   * shared `AuraSidebar` header so the filter follows the same
   * input the user types into.
   */
  searchQuery?: string;
}

/**
 * Left rail body for the public (logged-out) chat shell. Lists
 * public sessions read from `usePublicChatStore`.
 *
 * Intentionally does NOT reuse `components/SessionsList` — that
 * component is shaped around server-fetched `AnnotatedSession` rows
 * (project info, summaries, date bucketing) and adapting it to a
 * purely client-side public store would force a bag of fake fields.
 * A lightweight row list is the right tool for the small N of
 * public sessions.
 *
 * The "+" new-chat affordance and the search input live in the
 * shared `AuraSidebar` header; the public nav footer
 * (`PublicSidebarFooter`) is rendered as a sibling of this panel
 * inside `AuraSidebar` so it stays bottom-anchored even when the
 * Lane wrapping this body collapses to width 0.
 */
export function PublicSessionsPanel({
  searchQuery = "",
}: PublicSessionsPanelProps): React.ReactElement {
  const { t } = useTranslation("publicChat");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeSessionId = searchParams.get("session");

  const sessions = usePublicChatStore((s) => s.sessions);
  const sessionOrder = usePublicChatStore((s) => s.sessionOrder);
  const deleteSession = usePublicChatStore((s) => s.deleteSession);

  const orderedSessions = useMemo(
    () =>
      sessionOrder
        .map((id) => sessions[id])
        .filter((s): s is NonNullable<typeof s> => Boolean(s)),
    [sessionOrder, sessions],
  );

  const filteredSessions = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return orderedSessions;
    return orderedSessions.filter((session) =>
      session.title.toLowerCase().includes(needle),
    );
  }, [orderedSessions, searchQuery]);

  const handleSelect = useCallback(
    (id: string) => {
      navigate(`/chat?session=${id}`);
    },
    [navigate],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteSession(id);
      if (id !== activeSessionId) return;
      // The deleted row was the active session, so the URL still
      // points at it. Hop to the most recent remaining session
      // (sessionOrder is newest-first) when one exists so the
      // visitor lands on a populated chat rather than an empty
      // composer. When nothing remains, fall through to bare
      // `/chat`: `PublicChatView` no longer auto-mints on visit,
      // so the visitor sees an empty composer instead of a fresh
      // "New chat" row spawning on top of the one they just
      // removed.
      const nextActive = sessionOrder.find((existing) => existing !== id);
      navigate(nextActive ? `/chat?session=${nextActive}` : "/chat");
    },
    [activeSessionId, deleteSession, navigate, sessionOrder],
  );

  const isFiltering = searchQuery.trim().length > 0;
  const emptyMessage = isFiltering
    ? t("sessions.noMatchingChats", { defaultValue: "No matching chats" })
    : t("sessions.noConversations", { defaultValue: "No conversations yet" });

  return (
    <div className={styles.sessionsBody}>
      {filteredSessions.length === 0 ? (
        <div className={styles.emptyHint}>{emptyMessage}</div>
      ) : (
        filteredSessions.map((session) => (
          // Two sibling <button>s in a flex row instead of a delete
          // button nested inside a select button. Nesting interactive
          // content inside a <button> is invalid HTML and was the
          // root cause of unreliable click delivery on the X icon.
          <div
            key={session.id}
            className={`${styles.sessionRow} ${
              session.id === activeSessionId ? styles.sessionRowActive : ""
            }`}
          >
            <button
              type="button"
              className={styles.sessionRowSelect}
              onClick={() => handleSelect(session.id)}
            >
              <span className={styles.sessionRowTitle}>{session.title}</span>
            </button>
            <button
              type="button"
              className={styles.deleteButton}
              onClick={() => handleDelete(session.id)}
              aria-label={t("sessions.deleteChatAriaLabel", {
                defaultValue: `Delete chat "${session.title}"`,
                title: session.title,
              })}
            >
              <X size={14} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
