// World yaw headings are shared by gameplay, authored timing and asset clips.
// Selection is independent of the rendering camera and its baked projection.
export const HEADINGS = ['d00', 'd45', 'd90', 'd135', 'd180', 'd225', 'd270', 'd315'] as const;
export type Heading = (typeof HEADINGS)[number];
export function selectDirection(yaw: number, previous?: Heading, hysteresis = 0.045): Heading {
  if (!Number.isFinite(yaw)) throw new Error('direction yaw must be finite');
  const tau = Math.PI * 2,
    step = tau / 8,
    angle = ((yaw % tau) + tau) % tau;
  if (previous) {
    const p = HEADINGS.indexOf(previous) * step;
    const delta = Math.abs(Math.atan2(Math.sin(angle - p), Math.cos(angle - p)));
    if (delta < step / 2 + hysteresis) return previous;
  }
  return HEADINGS[Math.floor(angle / step + 0.5 + 1e-12) % 8]!; // ties go toward increasing heading
}
export const AUTHORED_HEADINGS = ['d00', 'd90', 'd180', 'd270'] as const;
export type AuthoredHeading = (typeof AUTHORED_HEADINGS)[number];
export function selectAuthoredDirection(yaw: number, previous?: Heading): AuthoredHeading {
  if (!Number.isFinite(yaw)) throw new Error('direction yaw must be finite');
  const step = Math.PI / 2,
    angle = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (previous && AUTHORED_HEADINGS.some((h) => h === previous)) {
    const p = (HEADINGS.indexOf(previous) * Math.PI) / 4;
    if (Math.abs(Math.atan2(Math.sin(angle - p), Math.cos(angle - p))) < step / 2 + 0.045)
      return previous as AuthoredHeading;
  }
  return AUTHORED_HEADINGS[Math.floor(angle / step + 0.5 + 1e-12) % 4]!;
}
