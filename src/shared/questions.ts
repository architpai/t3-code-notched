import { z } from "zod";
import { id, type Result } from "./contracts";

const question = z
  .object({
    id,
    header: z.string().min(1).max(512),
    question: z.string().min(1).max(16_384),
    options: z
      .array(
        z.object({
          label: z.string().min(1).max(4096),
          description: z.string().max(4096),
          value: z.string().max(4096).optional(),
        }),
      )
      .max(50),
    allowCustomAnswer: z.boolean().optional(),
    multiSelect: z.literal(false).optional(),
  })
  .refine((q) => q.allowCustomAnswer !== false || q.options.length > 0);
const requestSchema = z.object({
  requestId: id,
  responseMode: z.literal("message"),
  questions: z
    .array(question)
    .min(1)
    .max(10)
    .refine((items) => new Set(items.map((q) => q.id)).size === items.length),
});
export type AsyncQuestion = z.infer<typeof requestSchema> & {
  submission?: "sending" | "accepted" | "uncertain";
};
export const answerSchema = z
  .object({
    threadId: id,
    requestId: id,
    answers: z
      .record(id, z.string().min(1).max(16_384))
      .refine((answers) => Object.keys(answers).length <= 10),
  })
  .strict();
export type QuestionAnswer = z.infer<typeof answerSchema>;
export type QuestionAnswerResult = Result & { retryable: boolean };
export const activitiesSchema = z
  .array(
    z.object({
      id,
      kind: z.string().max(256),
      createdAt: z.iso.datetime({ offset: true }),
      payload: z.unknown(),
    }),
  )
  .max(10_000);

/** Pending requests are pinned by T3 even when only two turns are read. */
export function pendingQuestions(
  activities: z.infer<typeof activitiesSchema>,
): AsyncQuestion[] {
  const pending = new Map<string, AsyncQuestion>();
  const resolved = new Set<string>();
  for (const activity of activities.toSorted(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  )) {
    if (activity.kind === "user-input.requested") {
      const parsed = requestSchema.safeParse(activity.payload);
      if (parsed.success && !resolved.has(parsed.data.requestId))
        pending.set(parsed.data.requestId, parsed.data);
    } else if (
      activity.kind === "user-input.resolved" ||
      activity.kind === "provider.user-input.respond.failed"
    ) {
      const parsed = z.object({ requestId: id }).safeParse(activity.payload);
      // Failed responses need attention in T3; never offer a blind resend.
      if (parsed.success) {
        resolved.add(parsed.data.requestId);
        pending.delete(parsed.data.requestId);
      }
    }
  }
  return [...pending.values()];
}

export function validAnswers(
  request: AsyncQuestion,
  answers: QuestionAnswer["answers"],
): boolean {
  return (
    Object.keys(answers).length === request.questions.length &&
    request.questions.every((q) => {
      const value = answers[q.id];
      return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        (q.allowCustomAnswer !== false ||
          q.options.some((o) => (o.value ?? o.label) === value))
      );
    })
  );
}
