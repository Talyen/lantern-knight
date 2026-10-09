// Execution clocks start after command admission; nested phases cannot reset them.
export function taskBudget(task: string, platform = process.platform) {
  if (task === 'verify:full') return 9 * 60_000;
  if (task === 'test:e2e') return (platform === 'win32' ? 3 : 5) * 60_000;
  if (task.startsWith('dev') || task === 'scene:dev' || task === 'scene:editor') return undefined;
  if (task.startsWith('assets:') && !['assets:check', 'assets:pin:current'].includes(task))
    return undefined;
  return 5 * 60_000;
}

export function executionDeadline(budget: number, inherited?: string, now = Date.now()) {
  const prior = Number(inherited);
  return String(Math.min(now + budget, Number.isFinite(prior) && prior > 0 ? prior : Infinity));
}
