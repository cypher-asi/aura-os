import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LLMOutput } from "../../../apps/chat/components/LLMOutput";
import {
  ShareNotFoundError,
  getPublicShare,
  isValidShareToken,
} from "../../../shared/api/shares";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import { buildDisplayEvents } from "../../../utils/build-display-messages";
import styles from "./SharedSessionView.module.css";

/**
 * Read-only viewer for a public `/s/:shareToken` conversation.
 *
 * Reads the `:shareToken` route param, validates its `t_<32hex>` shape,
 * fetches the transcript from the PUBLIC `GET /api/public/share/:token`
 * endpoint (no auth header — see `getPublicShare`), and renders the
 * turns through the same `LLMOutput` path the live chat uses so a shared
 * conversation reads consistently. There is no action row, no input bar,
 * and no regenerate — this surface is strictly read-only.
 *
 * The view reads its param itself via the router hook, so it takes no
 * props and can be mounted unchanged inside either the public-mode shell
 * (`PublicMarketingPanel`) or the authenticated `AuraShell`.
 */
type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly events: DisplaySessionEvent[] }
  | { readonly status: "not-found" }
  | { readonly status: "error" };

export function SharedSessionView(): React.ReactElement {
  const { t } = useTranslation("publicChat");
  const { shareToken } = useParams<{ shareToken: string }>();
  const token = shareToken ?? "";
  // The `.root` section owns the vertical scroll in both mount contexts
  // (logged-out `PublicMarketingPanel` and authenticated `AuraShell`), so
  // the loaded transcript pins it to the bottom — see `SharedSessionContent`.
  const containerRef = useRef<HTMLElement>(null);

  return (
    <section
      ref={containerRef}
      className={styles.root}
      aria-label={t("sharedSession.ariaLabel", {
        defaultValue: "Shared conversation",
      })}
    >
      <div className={styles.column}>
        {isValidShareToken(token) ? (
          // Key on the token so a navigation between two share links
          // remounts the loader with a fresh `loading` state instead of
          // synchronously resetting state inside an effect.
          <SharedSessionLoader key={token} token={token} containerRef={containerRef} />
        ) : (
          <ShareMessage
            heading={t("sharedSession.unavailable.heading", {
              defaultValue: "This share link is unavailable",
            })}
            body={t("sharedSession.unavailable.body", {
              defaultValue:
                "The conversation may have been unshared or the link is incorrect.",
            })}
          />
        )}
      </div>
    </section>
  );
}

function SharedSessionLoader({
  token,
  containerRef,
}: {
  token: string;
  containerRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void getPublicShare(token)
      .then((events) => {
        if (!active) return;
        setState({ status: "ready", events: buildDisplayEvents(events) });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(
          error instanceof ShareNotFoundError
            ? { status: "not-found" }
            : { status: "error" },
        );
      });

    return () => {
      active = false;
    };
  }, [token]);

  return <SharedSessionContent state={state} containerRef={containerRef} />;
}

function SharedSessionContent({
  state,
  containerRef,
}: {
  state: LoadState;
  containerRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement {
  const { t } = useTranslation("publicChat");
  // Land the viewer at the bottom (latest message) once the transcript
  // commits. The conversation is static (`isStreaming={false}`) and the
  // markdown lays out synchronously, so a single layout-effect pin runs
  // after the DOM mutates but before paint — no visible scroll jump.
  useLayoutEffect(() => {
    if (state.status !== "ready" || state.events.length === 0) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state, containerRef]);

  if (state.status === "loading") {
    return (
      <p className={styles.status} role="status" aria-live="polite">
        {t("sharedSession.loading", {
          defaultValue: "Loading shared conversation…",
        })}
      </p>
    );
  }

  if (state.status === "not-found") {
    return (
      <ShareMessage
        heading={t("sharedSession.unavailable.heading", {
          defaultValue: "This share link is unavailable",
        })}
        body={t("sharedSession.unavailable.body", {
          defaultValue:
            "The conversation may have been unshared or the link is incorrect.",
        })}
      />
    );
  }

  if (state.status === "error") {
    return (
      <ShareMessage
        heading={t("sharedSession.error.heading", {
          defaultValue: "Something went wrong",
        })}
        body={t("sharedSession.error.body", {
          defaultValue:
            "We couldn't load this shared conversation. Please try again later.",
        })}
      />
    );
  }

  if (state.events.length === 0) {
    return (
      <ShareMessage
        heading={t("sharedSession.empty.heading", {
          defaultValue: "This conversation is empty",
        })}
        body={t("sharedSession.empty.body", {
          defaultValue:
            "There are no messages to show in this shared conversation.",
        })}
      />
    );
  }

  return (
    <>
      {state.events.map((event) => (
        <SharedTranscriptTurn key={event.clientId ?? event.id} event={event} />
      ))}
    </>
  );
}

function ShareMessage({
  heading,
  body,
}: {
  heading: string;
  body: string;
}): React.ReactElement {
  return (
    <div className={styles.emptyState} role="status">
      <h1 className={styles.heading}>{heading}</h1>
      <p className={styles.status}>{body}</p>
    </div>
  );
}

function SharedTranscriptTurn({
  event,
}: {
  event: DisplaySessionEvent;
}): React.ReactElement {
  const isUser = event.role === "user";
  const rowClass = isUser
    ? `${styles.row} ${styles.rowUser}`
    : `${styles.row} ${styles.rowAssistant}`;

  return (
    <div className={rowClass}>
      <div className={styles.bubble}>
        {isUser ? (
          event.content
        ) : (
          <LLMOutput
            content={event.content}
            timeline={event.timeline}
            toolCalls={event.toolCalls}
            thinkingText={event.thinkingText}
            thinkingDurationMs={event.thinkingDurationMs}
            artifactRefs={event.artifactRefs}
            isStreaming={false}
            className={styles.assistantOutput}
          />
        )}
      </div>
    </div>
  );
}
