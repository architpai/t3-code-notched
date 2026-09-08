/** Only input in the notch counts as activity; agent updates do not reset it. */
export function watchInactivity(
  target: EventTarget,
  delay: number,
  onIdle: () => void,
): () => void {
  if (delay <= 0) return () => {};
  let timer: ReturnType<typeof setTimeout>;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(onIdle, delay);
  };
  const events = [
    "pointermove",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "keydown",
    "wheel",
    "focusin",
  ];
  for (const event of events)
    target.addEventListener(event, reset, { passive: true });
  reset();
  return () => {
    clearTimeout(timer);
    for (const event of events) target.removeEventListener(event, reset);
  };
}
