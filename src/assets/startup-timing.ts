// Standard Performance entries are readable by diagnostics without a player inspection API.
let finished = false;
export function finishStartupTiming() {
  finished = true;
}
export async function startupStage<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (
    finished ||
    (typeof location !== 'undefined' && !['/', '/index.html'].includes(location.pathname))
  )
    return work();
  const start = performance.now();
  try {
    return await work();
  } finally {
    performance.measure('lantern-startup:' + name, { start, end: performance.now() });
  }
}
