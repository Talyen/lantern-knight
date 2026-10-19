import { visualEffectLabels } from './visual-effects';
import { type ContentDefinitions, type AreaDefinition } from './world';
import { contentDefinitions } from './game-content';

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
  outlines: 'Always-visible outlines',
  contact: 'Contact grounding',
  shafts: 'Light shafts',
} as const;
export type PlaygroundEffect = keyof typeof effectLabels;
export type OutlineSettings = {
  thickness: number;
  opacity: number;
  color: string;
  style: 'solid' | 'double' | 'rim';
};
export const outlinePresets = {
  none: { label: 'Original artwork', thickness: 1, opacity: 0, color: '#101010', style: 'solid' },
  fine: { label: 'Black ink · 2 px', thickness: 2, opacity: 0.8, color: '#101010', style: 'solid' },
  bold: {
    label: 'Black ink · 3 px',
    thickness: 3,
    opacity: 1,
    color: '#101010',
    style: 'solid',
  },
  sepia: {
    label: 'Black ink · 4 px',
    thickness: 4,
    opacity: 1,
    color: '#080808',
    style: 'solid',
  },
  paper: {
    label: 'Soft charcoal · 4 px',
    thickness: 4,
    opacity: 0.65,
    color: '#242424',
    style: 'solid',
  },
  double: {
    label: 'Dark double edge · 4 px',
    thickness: 4,
    opacity: 1,
    color: '#080808',
    style: 'double',
  },
  rim: {
    label: 'Directional charcoal · 3 px',
    thickness: 3,
    opacity: 0.9,
    color: '#303030',
    style: 'rim',
  },
} as const satisfies Record<string, OutlineSettings & { label: string }>;
export type PlaygroundSettings = {
  effects: Record<PlaygroundEffect, boolean>;
  treatment: 'quiet' | 'rich';
  baseline: boolean;
  paused: boolean;
  outline: OutlineSettings;
};
export function playgroundDefaults(): PlaygroundSettings {
  const effects = {} as Record<PlaygroundEffect, boolean>;
  for (const key of Object.keys(effectLabels) as PlaygroundEffect[]) effects[key] = true;
  return {
    effects,
    treatment: 'quiet',
    baseline: false,
    paused: false,
    outline: { thickness: 3, opacity: 1, color: '#101010', style: 'solid' },
  };
}
