/** Player preferences permit effects; scene state determines whether they occur. */
export const visualEffectLabels = {
  livingLights: 'Living lights',
  smoke: 'Smoke & embers',
  rain: '2D rain & splashes',
  surfaceDepth: 'Surface normals',
  relief: 'Shallow surface relief',
  wind: 'Foliage wind',
  atmosphere: 'Ground mist & motes',
  palette: 'Colored shadows & highlights',
  bloom: 'Bloom',
} as const;
export type VisualEffect = keyof typeof visualEffectLabels;
export type VisualEffects = Record<VisualEffect, boolean>;
export const defaultVisualEffects = (): VisualEffects =>
  Object.fromEntries(Object.keys(visualEffectLabels).map((k) => [k, true])) as VisualEffects;
export type WeatherState = { rain: number; wind: { x: number; z: number } };
export const dryWeather = (): WeatherState => ({ rain: 0, wind: { x: 0, z: 0 } });
export function normalizeWeather(state: WeatherState): WeatherState {
  return {
    rain: Number.isFinite(state.rain) ? Math.max(0, Math.min(1, state.rain)) : 0,
    wind: {
      x: Number.isFinite(state.wind.x) ? Math.max(-3, Math.min(3, state.wind.x)) : 0,
      z: Number.isFinite(state.wind.z) ? Math.max(-3, Math.min(3, state.wind.z)) : 0,
    },
  };
}
export function lightFlicker(time: number, phase: number) {
  return (
    1 +
    0.08 * Math.sin(time * 6.1 + phase) +
    0.04 * Math.sin(time * 13.7 + phase * 3) +
    0.025 * Math.sin(time * 21.3 + phase * 8)
  );
}
