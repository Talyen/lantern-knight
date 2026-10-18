type Recording = {
  gaps: number[];
  loading: number[];
  times: number[];
  events: { at: number; kind: string }[];
  foreground: boolean;
  overflow: boolean;
  stop(): void;
};
// Serialized into the packaged renderer by Playwright. Keep this function
// self-contained: no runtime dependency or global inspection API in Game.
export function installPacingRecorder() {
  const gaps: number[] = [],
    loading: number[] = [],
    times: number[] = [];
  const events: { at: number; kind: string }[] = [];
  const blocked = () =>
    document.body.classList.contains('traveling') || !!document.querySelector('dialog[open]');
  let wasBlocked = blocked(),
    activeSince = performance.now(),
    last = 0,
    request = 0,
    closed = false;
  const input = (e: Event) => {
    if (events.length >= 20000) {
      state.overflow = true;
      return;
    }
    events.push({
      at: performance.now(),
      kind:
        e instanceof KeyboardEvent
          ? `${e.type}:${e.code}`
          : `${e.type}:${(e.target as HTMLElement).id || (e.target as HTMLElement).tagName}`,
    });
  };
  const lostFocus = () => {
    state.foreground = false;
  };
  const visibility = () => {
    if (document.hidden) lostFocus();
  };
  const observer = new MutationObserver(() => {
    const next = blocked();
    if (next === wasBlocked) return;
    wasBlocked = next;
    if (!next) activeSince = performance.now();
  });
  const state: Recording = {
    gaps,
    loading,
    times,
    events,
    foreground: document.hasFocus() && !document.hidden,
    overflow: false,
    stop: () => {
      closed = true;
      cancelAnimationFrame(request);
      observer.disconnect();
      document.removeEventListener('keydown', input, true);
      document.removeEventListener('pointerdown', input, true);
      window.removeEventListener('blur', lostFocus);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
  const frame = (now: number) => {
    if (closed) return;
    state.foreground &&= document.hasFocus() && !document.hidden;
    const paused = blocked();
    if (last) {
      const interval = paused ? now - last : now - Math.max(last, activeSince);
      const target = paused ? loading : gaps;
      if (target.length >= 100000) state.overflow = true;
      else if (interval > 0) {
        target.push(interval);
        if (!paused) times.push(now);
      }
    }
    last = now;
    request = requestAnimationFrame(frame);
  };
  observer.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ['class', 'open'],
  });
  document.addEventListener('keydown', input, true);
  document.addEventListener('pointerdown', input, true);
  window.addEventListener('blur', lostFocus);
  document.addEventListener('visibilitychange', visibility);
  Reflect.set(window, '__pacing', state);
  request = requestAnimationFrame(frame);
}
export function readPacingRecorder(stop = true) {
  const s = Reflect.get(window, '__pacing') as Recording;
  if (stop) {
    s.stop();
    Reflect.deleteProperty(window, '__pacing');
  }
  return {
    gaps: s.gaps,
    loading: s.loading,
    times: s.times,
    events: s.events,
    foreground: s.foreground,
    overflow: s.overflow,
  };
}
