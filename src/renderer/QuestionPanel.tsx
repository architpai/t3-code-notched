import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Bridge } from "../shared/contracts";
import { validAnswers, type AsyncQuestion } from "../shared/questions";

export function questionOptionIndex(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat"
  >,
  editing: boolean,
  count: number,
): number | null {
  if (
    editing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.repeat ||
    !/^[1-9]$/.test(event.key)
  )
    return null;
  const index = Number(event.key) - 1;
  return index < count ? index : null;
}

export function questionSubmitKey(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "shiftKey"
    | "altKey"
    | "ctrlKey"
    | "metaKey"
    | "repeat"
    | "isComposing"
  >,
): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.repeat &&
    !event.isComposing
  );
}

export function QuestionPanel({
  request,
  threadId,
  bridge,
  canAnswer,
  active,
  footer,
  busy,
  drafts,
  draftKey,
  onBusy,
  onAccepted,
  onSettings,
}: {
  request: AsyncQuestion;
  threadId: string;
  bridge: Bridge;
  canAnswer: boolean;
  active: boolean;
  footer?: HTMLDivElement | null;
  busy: boolean;
  drafts: Map<string, Record<string, string>>;
  draftKey: string;
  onBusy: (busy: boolean) => void;
  onAccepted: () => void;
  onSettings: () => void;
}) {
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [answers, setAnswers] = useState(() => drafts.get(draftKey) ?? {});
  const [questionIndex, setQuestionIndex] = useState(0);
  const q = request.questions[questionIndex]!;
  const [message, setMessage] = useState("");
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [submitted, setSubmitted] = useState(false);
  const disabled = busy || submitted || Boolean(request.submission);
  function answer(id: string, value: string) {
    const next = { ...answers, [id]: value };
    drafts.set(draftKey, next);
    setAnswers(next);
  }
  useEffect(() => {
    if (!active || disabled) return;
    const key = (event: KeyboardEvent) => {
      if (
        questionSubmitKey(event) &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest(
            'button, a, select, input:not([type="radio"]), [contenteditable="true"]',
          )
        )
      ) {
        event.preventDefault();
        form.current?.requestSubmit();
        return;
      }
      const editing =
        event.target instanceof HTMLElement &&
        Boolean(
          event.target.closest(
            'textarea, input:not([type="radio"]), select, [contenteditable="true"]',
          ),
        );
      const index = questionOptionIndex(event, editing, q.options.length);
      if (index === null) return;
      event.preventDefault();
      const option = q.options[index]!;
      answer(q.id, option.value ?? option.label);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [active, disabled, q, answers]);
  const actions = (
    <div className="question-actions">
      {!canAnswer && (
        <button
          type="button"
          className="question-settings"
          onClick={onSettings}
        >
          Reconnect to enable sending
        </button>
      )}
      <button
        className="primary"
        type="submit"
        form={formId}
        disabled={!canAnswer || disabled || !validAnswers(request, answers)}
      >
        Submit
      </button>
    </div>
  );
  return (
    <form
      id={formId}
      ref={form}
      className="question-panel"
      aria-label="Async questions"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !canAnswer ||
          disabled ||
          sending.current ||
          !validAnswers(request, answers)
        )
          return;
        sending.current = true;
        setSubmitted(true);
        onBusy(true);
        setMessage("Sending answer…");
        void bridge
          .answerQuestion({ threadId, requestId: request.requestId, answers })
          .then((result) => {
            setMessage(result.message);
            if (result.ok) {
              drafts.delete(draftKey);
              if (mounted.current) onAccepted();
            } else if (result.retryable) {
              sending.current = false;
              setSubmitted(false);
            }
          })
          // A lost IPC reply may follow an accepted command. Never enable a blind resend.
          .catch(() =>
            setMessage("Answer not confirmed. Check T3 before sending again."),
          )
          .finally(() => onBusy(false));
      }}
    >
      {request.questions.length > 1 && (
        <div className="question-navigation">
          <button
            type="button"
            disabled={questionIndex === 0}
            onClick={() => setQuestionIndex(questionIndex - 1)}
          >
            Previous
          </button>
          <span>
            Question {questionIndex + 1} of {request.questions.length}
          </span>
          <button
            type="button"
            disabled={questionIndex === request.questions.length - 1}
            onClick={() => setQuestionIndex(questionIndex + 1)}
          >
            Next
          </button>
        </div>
      )}
      <fieldset key={q.id} disabled={disabled}>
        <legend>{q.question}</legend>
        <div className="question-options">
          {q.options.map((option, index) => {
            const value = option.value ?? option.label;
            return (
              <label className="question-choice" key={index}>
                <input
                  type="radio"
                  name={`${draftKey}:${q.id}`}
                  value={value}
                  checked={answers[q.id] === value}
                  onChange={() => answer(q.id, value)}
                />
                <span>
                  {index < 9 && <kbd>{index + 1}</kbd>} {option.label}
                  {option.description && <small>{option.description}</small>}
                </span>
              </label>
            );
          })}
        </div>
        {q.allowCustomAnswer !== false && (
          <label className="question-custom">
            {q.options.length ? "Or type an answer" : "Your answer"}
            <textarea
              rows={1}
              placeholder="Type your answer…"
              maxLength={16_384}
              value={
                q.options.some((o) => (o.value ?? o.label) === answers[q.id])
                  ? ""
                  : (answers[q.id] ?? "")
              }
              onChange={(event) => answer(q.id, event.target.value)}
            />
          </label>
        )}
      </fieldset>
      {footer ? createPortal(actions, footer) : actions}
      {(message || request.submission) && (
        <p role="status">
          {message ||
            (request.submission === "accepted"
              ? "Answer accepted by T3."
              : request.submission === "sending"
                ? "Sending answer…"
                : "Answer not confirmed. Check T3.")}
        </p>
      )}
    </form>
  );
}
