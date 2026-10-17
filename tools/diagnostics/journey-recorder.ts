// Serialized into Game. UI phases keep dialogs interactive; explicit loading
// remains separate. Arrival phases additionally exclude paused menus.
export function installJourneyRecorder(excludeDialogs: boolean) {
  const blocked = () =>
    document.body.classList.contains('traveling') ||
    (excludeDialogs && !!document.querySelector('dialog[open]'));
  const s = {
    frames: [] as number[],
    loading: [] as number[],
    frameTimes: [] as number[],
    last: 0,
    activeSince: performance.now(),
    request: 0,
    foreground: document.hasFocus() && !document.hidden,
    overflow: false,
    stop: () => {
      cancelAnimationFrame(s.request);
      observer.disconnect();
      window.removeEventListener('blur', lostFocus);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
  const lostFocus = () => {
    s.foreground = false;
  };
  const visibility = () => {
    if (document.hidden) lostFocus();
  };
  let wasBlocked = blocked();
  const observer = new MutationObserver(() => {
    const next = blocked();
    if (next !== wasBlocked && !next) s.activeSince = performance.now();
    wasBlocked = next;
  });
  observer.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ['class', 'open'],
  });
  window.addEventListener('blur', lostFocus);
  document.addEventListener('visibilitychange', visibility);
  const frame = (now: number) => {
    s.foreground &&= document.hasFocus() && !document.hidden;
    if (s.last) {
      const paused = blocked(),
        interval = now - (paused ? s.last : Math.max(s.last, s.activeSince)),
        target = paused ? s.loading : s.frames;
      if (target.length >= 100000) s.overflow = true;
      else if (interval > 0) {
        target.push(interval);
        if (!paused) s.frameTimes.push(now);
      }
    }
    s.last = now;
    s.request = requestAnimationFrame(frame);
  };
  Reflect.set(window, '__journeyFrames', s);
  s.request = requestAnimationFrame(frame);
}

export function readJourneyRecorder() {
  const s = Reflect.get(window, '__journeyFrames') as {
    frames: number[];
    loading: number[];
    frameTimes: number[];
    foreground: boolean;
    overflow: boolean;
    stop(): void;
  };
  s.stop();
  Reflect.deleteProperty(window, '__journeyFrames');
  return {
    frames: s.frames,
    loading: s.loading,
    frameTimes: s.frameTimes,
    foreground: s.foreground,
    overflow: s.overflow,
  };
}
