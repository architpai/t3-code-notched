import { expect, it, vi } from "vitest";
import { watchInactivity } from "../src/renderer/inactivity";

it("collapses after inactivity, resets on user input, and supports Off and cleanup", () => {
  vi.useFakeTimers();
  try {
    const target = new EventTarget();
    const close = vi.fn();
    const stop = watchInactivity(target, 30000, close);
    vi.advanceTimersByTime(29000);
    expect(close).not.toHaveBeenCalled();
    target.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(29000);
    expect(close).not.toHaveBeenCalled();
    target.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(30000);
    expect(close).toHaveBeenCalledTimes(1);
    stop();
    target.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(60000);
    expect(close).toHaveBeenCalledTimes(1);
    const off = watchInactivity(target, 0, close);
    target.dispatchEvent(new Event("wheel"));
    vi.advanceTimersByTime(300000);
    expect(close).toHaveBeenCalledTimes(1);
    off();
    const cancel = watchInactivity(target, 15000, close);
    cancel();
    vi.advanceTimersByTime(15000);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
