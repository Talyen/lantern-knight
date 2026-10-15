// Milliseconds relative to the authoritative damage pulse.
export function flareLightEnvelope(ms: number) {
  if (ms < -100 || ms >= 250) return 0;
  if (ms < 0) return (ms + 100) / 100;
  return (1 - ms / 250) ** 2;
}
