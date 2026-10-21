// World yaw headings are shared by gameplay, authored timing and asset clips.
// Selection is independent of the rendering camera and its baked projection.
export const HEADINGS = ['d00', 'd45', 'd90', 'd135', 'd180', 'd225', 'd270', 'd315'] as const;
export type Heading = (typeof HEADINGS)[number];
const hysteresis = 0.045;
const normalize = (yaw: number) => {
  if (!Number.isFinite(yaw)) throw new Error('direction yaw must be finite');
  const tau = Math.PI * 2;
  return ((yaw % tau) + tau) % tau;
};
const angularDelta = (angle: number, reference: number) =>
  Math.abs(Math.atan2(Math.sin(angle - reference), Math.cos(angle - reference)));
export function selectDirection(yaw: number, previous?: Heading, hold = hysteresis): Heading {
  const tau = Math.PI * 2,
    step = tau / 8,
    angle = normalize(yaw);
  if (previous && (HEADINGS as readonly string[]).includes(previous)) {
    const p = HEADINGS.indexOf(previous) * step;
    if (angularDelta(angle, p) < step / 2 + hold) return previous;
  }
  return HEADINGS[Math.floor(angle / step + 0.5 + 1e-12) % 8]!; // ties go toward increasing heading
}
export const AUTHORED_HEADINGS = ['d00', 'd90', 'd180', 'd270'] as const;
export type AuthoredHeading = (typeof AUTHORED_HEADINGS)[number];
export function selectAuthoredDirection(yaw: number, previous?: Heading): AuthoredHeading {
  const step = Math.PI / 2,
    angle = normalize(yaw);
  if (previous && (AUTHORED_HEADINGS as readonly string[]).includes(previous)) {
    const p = (HEADINGS.indexOf(previous) * Math.PI) / 4;
    if (angularDelta(angle, p) < step / 2 + hysteresis) return previous as AuthoredHeading;
  }
  return AUTHORED_HEADINGS[Math.floor(angle / step + 0.5 + 1e-12) % 4]!;
}
