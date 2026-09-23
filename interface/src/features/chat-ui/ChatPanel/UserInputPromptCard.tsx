import { CircleHelp } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";

import {
  streamsApi,
  type UserInputAnswers,
} from "../../../shared/api/streams";
import { isAgentSessionRouteCurrent } from "../../../shared/lib/agent-session-route";
import {
  type AgentUserInputItem,
  useAgentAttentionStore,
} from "../../../stores/agent-attention-store";
import styles from "./UserInputPromptCard.module.css";

type DraftAnswers = Record<string, string | string[]>;
type CustomAnswers = Record<string, { enabled: boolean; value: string }>;

export function UserInputPromptCard() {
  const location = useLocation();
  const pendingInputs = useAgentAttentionStore((state) => state.pendingInputs);
  const currentUrl = `${location.pathname}${location.search}`;
  const request = useMemo(
    () => Object.values(pendingInputs)
      .filter((item): item is AgentUserInputItem => (
        !!item && isAgentSessionRouteCurrent(item.route, currentUrl)
      ))
      .sort((left, right) => left.startedAt - right.startedAt)[0],
    [currentUrl, pendingInputs],
  );

  if (!request) return null;
  return <UserInputPromptContent key={request.requestId} request={request} />;
}

function initialAnswers(request: AgentUserInputItem): DraftAnswers {
  return Object.fromEntries(
    request.questions.map((question) => [question.id, question.multi_select ? [] : ""]),
  );
}

function UserInputPromptContent({ request }: { request: AgentUserInputItem }) {
  const [answers, setAnswers] = useState<DraftAnswers>(() => initialAnswers(request));
  const [custom, setCustom] = useState<CustomAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo<UserInputAnswers>(() => Object.fromEntries(
    request.questions.map((question) => {
      const customAnswer = custom[question.id];
      if (!question.multi_select) {
        return [question.id, customAnswer?.enabled
          ? customAnswer.value.trim()
          : String(answers[question.id] ?? "").trim()];
      }
      const selected = Array.isArray(answers[question.id])
        ? answers[question.id] as string[]
        : [];
      const values = [...selected];
      if (customAnswer?.enabled && customAnswer.value.trim()) {
        values.push(customAnswer.value.trim());
      }
      return [question.id, values];
    }),
  ), [answers, custom, request.questions]);

  const complete = request.questions.every((question) => {
    const answer = payload[question.id];
    return Array.isArray(answer) ? answer.length > 0 : answer.length > 0;
  });

  const toggleMultiple = (questionId: string, label: string, checked: boolean) => {
    setAnswers((current) => {
      const selected = Array.isArray(current[questionId])
        ? current[questionId] as string[]
        : [];
      return {
        ...current,
        [questionId]: checked
          ? [...selected, label]
          : selected.filter((entry) => entry !== label),
      };
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!complete || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await streamsApi.respondToUserInput(request.requestId, payload);
      useAgentAttentionStore.getState().resolveInput(request.requestId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send your answers.");
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.card} aria-label="Agent question">
      <div className={styles.headingRow}>
        <span className={styles.icon} aria-hidden="true"><CircleHelp size={18} /></span>
        <div className={styles.copy}>
          <strong>Your agent needs an answer</strong>
          <span>The run is paused in its environment and will continue after you reply.</span>
        </div>
      </div>

      <form onSubmit={(event) => void submit(event)}>
        {request.questions.map((question) => {
          const customAnswer = custom[question.id] ?? { enabled: false, value: "" };
          const selected = answers[question.id];
          return (
            <fieldset className={styles.question} key={question.id} disabled={submitting}>
              <legend>{question.header}</legend>
              <p>{question.question}</p>
              <div className={styles.options}>
                {question.options.map((option) => {
                  const checked = question.multi_select
                    ? Array.isArray(selected) && selected.includes(option.label)
                    : !customAnswer.enabled && selected === option.label;
                  return (
                    <label className={styles.option} key={option.label}>
                      <input
                        type={question.multi_select ? "checkbox" : "radio"}
                        name={`agent-question-${request.requestId}-${question.id}`}
                        value={option.label}
                        checked={checked}
                        onChange={(event) => {
                          if (question.multi_select) {
                            toggleMultiple(question.id, option.label, event.target.checked);
                          } else {
                            setAnswers((current) => ({
                              ...current,
                              [question.id]: option.label,
                            }));
                            setCustom((current) => ({
                              ...current,
                              [question.id]: { ...customAnswer, enabled: false },
                            }));
                          }
                        }}
                      />
                      <span><b>{option.label}</b><small>{option.description}</small></span>
                    </label>
                  );
                })}
                <label className={styles.option}>
                  <input
                    type={question.multi_select ? "checkbox" : "radio"}
                    name={`agent-question-${request.requestId}-${question.id}`}
                    checked={customAnswer.enabled}
                    onChange={(event) => setCustom((current) => ({
                      ...current,
                      [question.id]: { ...customAnswer, enabled: event.target.checked },
                    }))}
                  />
                  <span><b>Other</b><small>Write a different answer</small></span>
                </label>
                {customAnswer.enabled ? (
                  <input
                    className={styles.customInput}
                    aria-label={`${question.header} other answer`}
                    value={customAnswer.value}
                    maxLength={500}
                    autoFocus
                    onChange={(event) => setCustom((current) => ({
                      ...current,
                      [question.id]: { enabled: true, value: event.target.value },
                    }))}
                  />
                ) : null}
              </div>
            </fieldset>
          );
        })}
        <div className={styles.footer}>
          {error ? <p className={styles.error} role="alert">{error}</p> : <span />}
          <button type="submit" disabled={!complete || submitting}>
            {submitting ? "Sending…" : "Continue agent"}
          </button>
        </div>
      </form>
    </section>
  );
}
