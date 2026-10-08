import { visualEffectLabels } from './visual-effects';
import { contentDefinitions, type ContentDefinitions, type AreaDefinition } from './world';

export const effectsArea: AreaDefinition = {
  id: 'effects-playground',
  name: 'Effects Playground',
  subtitle: 'A separate courtyard for visual experiments',
  bounds: { minX: -7, maxX: 7, minZ: -6, maxZ: 7 },
  surface: { kind: 'flat', height: 0 },
  seedOffset: 903,
  baselineEntry: 'start',
  entries: [{ id: 'start', x: 0, z: 3 }],
  exits: [],
  activation: { minX: 6.8, maxX: 7, minZ: -6, maxZ: -5.8 },
  spawns: [{ id: 'target', actor: 'skeleton', x: 2.8, z: -0.7 }],
  props: [
    {
      id: 'shelter-post',
      kind: 'pillar',
      x: -4,
      z: -1.5,
      radius: 0.4,
      height: 2.8,
      blocking: true,
    },
    { id: 'stone-plinth', kind: 'pillar', x: 2, z: 1, radius: 0.42, height: 0.8, blocking: true },
  ],
  floorColor: 0x48534f,
};
export const effectsDefinitions: ContentDefinitions = {
  ...contentDefinitions,
  initialArea: effectsArea.id,
  areas: [effectsArea],
};

export const effectLabels = {
  ...visualEffectLabels,
  wetness: 'Wet surfaces & puddles',
  outlines: 'Selective outlines',
  contact: 'Contact grounding',
  shafts: 'Light shafts',
} as const;
export type PlaygroundEffect = keyof typeof effectLabels;
export type PlaygroundSettings = {
  effects: Record<PlaygroundEffect, boolean>;
  treatment: 'quiet' | 'rich';
  baseline: boolean;
  paused: boolean;
  outline: { thickness: number; opacity: number; color: string };
};
export function playgroundDefaults(): PlaygroundSettings {
  return {
    effects: Object.fromEntries(Object.keys(effectLabels).map((k) => [k, true])) as Record<
      PlaygroundEffect,
      boolean
    >,
    treatment: 'quiet',
    baseline: false,
    paused: false,
    outline: { thickness: 1, opacity: 0.25, color: '#29343b' },
  };
}
export function activeEffect(settings: PlaygroundSettings, key: PlaygroundEffect) {
  return !settings.baseline && settings.effects[key];
}
export { playgroundCatalog } from './effects-playground-assets';
