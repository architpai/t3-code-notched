import { threadSchema } from "../src/shared/contracts";
import { expect, it } from "vitest";
import {
  replyChanged,
  reconcilePreviews,
  newlySettled,
  countdownDelay,
  pauseClock,
} from "../src/renderer/replies";

it("notifies only about changed agent text after a successful baseline", () => {
  const old = { text: "Existing reply", error: null };
  expect(replyChanged(undefined, old)).toBe(false);
  expect(replyChanged(old, { ...old })).toBe(false);
  expect(replyChanged(old, { text: null, error: "Offline" })).toBe(false);
  expect(replyChanged(old, { text: "New reply", error: null })).toBe(true);
  expect(replyChanged({ text: null, error: null }, old)).toBe(true);
});

it("keeps unchanged polling results idle and updates changed or removed replies", () => {
  const previous = {
    a: { text: "Ready", error: null },
    b: { text: "Working", error: null },
  };
  expect(
    reconcilePreviews(previous, { a: { ...previous.a }, b: { ...previous.b } }),
  ).toBe(previous);
  const updated = reconcilePreviews(previous, {
    a: { ...previous.a },
    b: { text: "Done", error: null },
  });
  expect(updated).not.toBe(previous);
  expect(updated.a).toBe(previous.a);
  expect(updated.b?.text).toBe("Done");
  expect(reconcilePreviews(previous, { a: previous.a })).toEqual({
    a: previous.a,
  });
  expect(
    reconcilePreviews(previous, { a: { text: null, error: "Offline" } }).a
      ?.error,
  ).toBe("Offline");
});

it("notifies once when a known active thread becomes settled", () => {
  const active = threadSchema.parse({
    id: "a",
    projectId: "p",
    title: "Agent task",
    updatedAt: "2026-09-07T00:00:00Z",
    modelSelection: { instanceId: "provider", model: "model" },
    runtimeMode: "auto",
    interactionMode: "default",
    latestTurn: null,
    session: null,
  });
  const settled = { ...active, settledOverride: "settled" as const };
  expect(newlySettled(null, [settled])).toEqual([]);
  expect(newlySettled([active], [active])).toEqual([]);
  expect(newlySettled([active], [settled])).toEqual([settled]);
  expect(newlySettled([settled], [settled])).toEqual([]);
  expect(newlySettled([active], [])).toEqual([]);
  expect(
    newlySettled([active], [{ ...settled, archivedAt: active.updatedAt }]),
  ).toEqual([]);
  expect(
    newlySettled([active], [{ ...settled, backgroundLiveness: "working" }]),
  ).toEqual([]);
  expect(newlySettled([settled], [active])).toEqual([]);
});

it("keeps the countdown aligned with the real expiry, including late display", () => {
  const clock = { duration: 6000, expiresAt: 16000 };
  expect(countdownDelay(clock, 10000)).toBe(-0);
  expect(countdownDelay(clock, 12500)).toBe(-2500);
  expect(countdownDelay(clock, 20000)).toBe(-6000);
  expect(countdownDelay(clock, 9000)).toBe(-0);
});

it("freezes notification time while reading and resumes only the remaining time", () => {
  const clock = { duration: 6000, expiresAt: 16000 };
  const paused = pauseClock(clock, true, 12000)!;
  expect(countdownDelay(paused, 50000)).toBe(-2000);
  expect(pauseClock(paused, true, 40000)).toBe(paused);
  const resumed = pauseClock(paused, false, 50000)!;
  expect(resumed.expiresAt).toBe(54000);
  expect(countdownDelay(resumed, 50000)).toBe(-2000);
  expect(countdownDelay(resumed, 54000)).toBe(-6000);
  expect(pauseClock(resumed, false, 51000)).toBe(resumed);
  const again = pauseClock(resumed, true, 51000)!;
  expect(pauseClock(again, false, 60000)?.expiresAt).toBe(63000);
  const incoming = pauseClock(
    { duration: 6000, expiresAt: 56000 },
    true,
    50000,
  )!;
  expect(countdownDelay(incoming, 60000)).toBe(-0);
  expect(pauseClock(incoming, false, 60000)?.expiresAt).toBe(66000);
  expect(pauseClock(null, true, 10000)).toBeNull();
});
