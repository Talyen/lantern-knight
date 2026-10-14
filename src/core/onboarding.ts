import { z } from 'zod';
const lessons = [
  'hook',
  'sword',
  'dodge',
  'lantern',
  'inventory',
  'potion',
  'campfire',
  'travel',
] as const;
export type Lesson = (typeof lessons)[number];
export const OnboardingSchema = z
  .strictObject({
    completed: z.array(z.enum(lessons)).max(lessons.length),
    dismissed: z.array(z.enum(lessons)).max(lessons.length),
  })
  .refine(
    (value) =>
      new Set([...value.completed, ...value.dismissed]).size ===
      value.completed.length + value.dismissed.length,
    'Duplicate onboarding lesson',
  );
export type OnboardingState = {
  readonly completed: readonly Lesson[];
  readonly dismissed: readonly Lesson[];
};
export function onboardingState(
  value: OnboardingState = { completed: [], dismissed: [] },
): OnboardingState {
  const state = OnboardingSchema.parse(value);
  Object.freeze(state.completed);
  Object.freeze(state.dismissed);
  return Object.freeze(state);
}
