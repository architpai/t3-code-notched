import { expect, it } from "vitest";
import {
  activitiesSchema,
  pendingQuestions,
  validAnswers,
  answerSchema,
} from "../src/shared/questions";
import { reconcilePreviews } from "../src/renderer/replies";
const payload = {
  requestId: "r",
  responseMode: "message",
  questions: [
    {
      id: "0",
      header: "Theme",
      question: "Which theme?",
      options: [{ label: "Dark", description: "", value: "dark" }],
      allowCustomAnswer: false,
    },
  ],
};
function activity(kind: string, body: unknown, seconds = 0) {
  return {
    id: `a-${seconds}`,
    kind,
    payload: body,
    createdAt: new Date(seconds * 1000).toISOString(),
  };
}
it("shows async questions only and removes answered or failed requests in lifecycle order", () => {
  const requested = activity("user-input.requested", payload);
  const resolved = activity("user-input.resolved", { requestId: "r" }, 1);
  expect(pendingQuestions(activitiesSchema.parse([requested]))).toEqual([
    payload,
  ]);
  expect(
    pendingQuestions(activitiesSchema.parse([resolved, requested])),
  ).toEqual([]);
  expect(
    pendingQuestions(
      activitiesSchema.parse([
        requested,
        { ...resolved, kind: "provider.user-input.respond.failed" },
      ]),
    ),
  ).toEqual([]);
  for (const bad of [
    { ...payload, responseMode: undefined },
    { ...payload, questions: [...payload.questions, ...payload.questions] },
    { ...payload, questions: [{ ...payload.questions[0], multiSelect: true }] },
  ]) {
    expect(
      pendingQuestions(
        activitiesSchema.parse([activity("user-input.requested", bad)]),
      ),
    ).toEqual([]);
  }
});
it("validates all answer IDs, preserves option values, and permits custom text only when allowed", () => {
  const request = pendingQuestions(
    activitiesSchema.parse([activity("user-input.requested", payload)]),
  )[0]!;
  expect(validAnswers(request, { "0": "dark" })).toBe(true);
  for (const answers of [
    {},
    { "0": "Dark" },
    { "0": " " },
    { "0": "dark", extra: "dark" },
  ])
    expect(validAnswers(request, answers)).toBe(false);
  expect(
    validAnswers(
      {
        ...request,
        questions: request.questions.map((q) => ({
          ...q,
          allowCustomAnswer: true,
        })),
      },
      { "0": "Custom" },
    ),
  ).toBe(true);
  expect(
    answerSchema.safeParse({
      threadId: "t",
      requestId: "r",
      answers: { "0": "x" },
      command: "arbitrary",
    }).success,
  ).toBe(false);
});
it("refreshes questions even when agent reply text is unchanged", () => {
  const questions = pendingQuestions(
    activitiesSchema.parse([activity("user-input.requested", payload)]),
  );
  const before = { t: { text: "Working", error: null, questions } };
  expect(reconcilePreviews(before, structuredClone(before))).toBe(before);
  const after = reconcilePreviews(before, {
    t: { text: "Working", error: null, questions: [] },
  });
  expect(after).not.toBe(before);
  expect(after.t?.questions).toEqual([]);
});

it("opens each new question once, keeps the active question in place, and ignores stale or accepted requests", async () => {
  const { emptyState, threadSchema } = await import("../src/shared/contracts");
  const { pendingQuestionPrompts, nextQuestionPrompt } =
    await import("../src/renderer/replies");
  const state = emptyState();
  state.phase = "live";
  state.environmentId = "test-environment";
  const thread = threadSchema.parse({
    id: "t",
    projectId: "p",
    title: "Question test",
    updatedAt: "2026-09-13T00:00:00Z",
    modelSelection: { instanceId: "test-provider", model: "test-model" },
    runtimeMode: "auto",
    interactionMode: "default",
    latestTurn: null,
    session: null,
    hasPendingUserInput: true,
  });
  state.shell.threads = [thread, { ...thread, id: "second" }];
  const questions = pendingQuestions(
    activitiesSchema.parse([activity("user-input.requested", payload)]),
  );
  const previews = {
    t: { text: null, error: null, questions },
    second: { text: null, error: null, questions },
  };
  const prompts = pendingQuestionPrompts(state, previews);
  const seen = new Set<string>();
  const first = nextQuestionPrompt(prompts, seen)!;
  expect(first.threadId).toBe("t");
  seen.add(first.key);
  expect(nextQuestionPrompt(prompts, seen, "t")).toBeUndefined();
  expect(nextQuestionPrompt(prompts, seen)?.threadId).toBe("second");
  // Manual collapse acknowledges the currently pending prompts without answering them.
  for (const prompt of prompts) seen.add(prompt.key);
  expect(nextQuestionPrompt(prompts, seen)).toBeUndefined();
  const changed = pendingQuestionPrompts(state, {
    ...previews,
    t: {
      ...previews.t,
      questions: questions.map((q) => ({ ...q, requestId: "new-question" })),
    },
  });
  expect(nextQuestionPrompt(changed, seen)?.threadId).toBe("t");
  expect(
    pendingQuestionPrompts({ ...state, phase: "stale" }, previews),
  ).toEqual([]);
  expect(
    pendingQuestionPrompts(state, { t: { ...previews.t, error: "Offline" } }),
  ).toEqual([]);
  expect(
    pendingQuestionPrompts(state, {
      t: {
        ...previews.t,
        questions: questions.map((q) => ({ ...q, submission: "accepted" })),
      },
    }),
  ).toEqual([]);
  expect(
    pendingQuestionPrompts(
      {
        ...state,
        shell: {
          ...state.shell,
          threads: [{ ...thread, hasPendingUserInput: false }],
        },
      },
      previews,
    ),
  ).toEqual([]);
  expect(
    pendingQuestionPrompts(
      { ...state, environmentId: "different" },
      previews,
    )[0]?.key,
  ).not.toBe(first.key);
});

it("never restores a resolved request when lifecycle timestamps tie", () => {
  const requested = {
    ...activity("user-input.requested", payload),
    id: "z-request",
  };
  const resolved = {
    ...activity("user-input.resolved", { requestId: "r" }),
    id: "a-resolved",
  };
  for (const activities of [
    [requested, resolved],
    [resolved, requested],
  ])
    expect(pendingQuestions(activitiesSchema.parse(activities))).toEqual([]);
});

it("does not display a question with no allowed answer", () => {
  const invalid = {
    ...payload,
    questions: [
      { ...payload.questions[0], options: [], allowCustomAnswer: false },
    ],
  };
  expect(
    pendingQuestions(
      activitiesSchema.parse([activity("user-input.requested", invalid)]),
    ),
  ).toEqual([]);
});

it("selects numbered options without taking digits from text or thread shortcuts", async () => {
  const { questionOptionIndex } = await import("../src/renderer/QuestionPanel");
  const key = {
    key: "2",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
  };
  expect(questionOptionIndex(key, false, 3)).toBe(1);
  expect(questionOptionIndex(key, true, 3)).toBeNull();
  expect(questionOptionIndex({ ...key, metaKey: true }, false, 3)).toBeNull();
  expect(questionOptionIndex({ ...key, ctrlKey: true }, false, 3)).toBeNull();
  expect(questionOptionIndex({ ...key, repeat: true }, false, 3)).toBeNull();
  expect(questionOptionIndex({ ...key, key: "0" }, false, 3)).toBeNull();
  expect(questionOptionIndex({ ...key, key: "4" }, false, 3)).toBeNull();
});

it("keeps answer fields available on a read-only connection while blocking submission", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { QuestionPanel } = await import("../src/renderer/QuestionPanel");
  const { demoBridge } = await import("../src/renderer/demo");
  const request = pendingQuestions([
    activity("user-input.requested", {
      ...payload,
      questions: [{ ...payload.questions[0], allowCustomAnswer: true }],
    }),
  ])[0]!;
  const markup = renderToStaticMarkup(
    createElement(QuestionPanel, {
      request,
      threadId: "thread",
      bridge: demoBridge(),
      canAnswer: false,
      active: true,
      busy: false,
      drafts: new Map(),
      draftKey: "draft",
      onBusy: () => {},
      onAccepted: () => {},
      onSettings: () => {},
    }),
  );
  expect(markup).not.toMatch(/<fieldset[^>]*disabled/);
  expect(markup).toContain('placeholder="Type your answer…"');
  expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  expect(markup).toContain("Reconnect to enable sending");
});

it("submits with Enter but preserves Shift+Enter and text composition", async () => {
  const { questionSubmitKey } = await import("../src/renderer/QuestionPanel");
  const event = {
    key: "Enter",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
  };
  expect(questionSubmitKey(event)).toBe(true);
  for (const flag of [
    "shiftKey",
    "altKey",
    "ctrlKey",
    "metaKey",
    "repeat",
    "isComposing",
  ])
    expect(questionSubmitKey({ ...event, [flag]: true })).toBe(false);
  expect(questionSubmitKey({ ...event, key: "2" })).toBe(false);
});
