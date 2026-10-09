import { commands } from './commands';
// Execution clocks start after command admission; nested phases cannot reset them.
export function taskBudget(task: string, platform = process.platform) {
  const budget = commands[task]?.deadlineMs;
  return typeof budget === 'function' ? budget(platform) : (budget ?? undefined);
}

export function executionDeadline(budget: number, inherited?: string, now = Date.now()) {
  const prior = Number(inherited);
  return String(Math.min(now + budget, Number.isFinite(prior) && prior > 0 ? prior : Infinity));
}
