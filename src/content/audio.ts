export type AudioCue =
  | 'step-dirt'
  | 'step-stone'
  | 'step-wood'
  | 'step-grass'
  | 'sword'
  | 'impact'
  | 'bone'
  | 'hurt'
  | 'cloth'
  | 'armor'
  | 'dodge'
  | 'flare'
  | 'heal'
  | 'potion'
  | 'coin'
  | 'pickup'
  | 'container'
  | 'break'
  | 'fire'
  | 'travel'
  | 'equip'
  | 'unequip'
  | 'salvage'
  | 'ui-confirm'
  | 'ui-cancel'
  | 'ui-deny'
  | 'success'
  | 'death'
  | 'forest'
  | 'wind'
  | 'campfire';
export type AudioSettings = { master: number; effects: number; ambience: number; muted: boolean };
export const defaultAudioSettings: AudioSettings = {
  master: 0.8,
  effects: 0.8,
  ambience: 0.65,
  muted: false,
};
export type AreaAudio = {
  surface: 'dirt' | 'stone' | 'wood' | 'grass';
  ambience: readonly AudioCue[];
};
// Explicit production defaults; unknown developer fixtures use quiet stone foley.
const areas: Readonly<Record<string, AreaAudio>> = {
  'outdoor-fixture': { surface: 'grass', ambience: ['forest', 'wind'] },
  'interior-fixture': { surface: 'stone', ambience: [] },
  'abandoned-orchard': { surface: 'grass', ambience: ['wind', 'forest'] },
  'forest-gathering-clearing': { surface: 'dirt', ambience: ['forest', 'wind'] },
};
export function areaAudio(id: string): AreaAudio {
  return areas[id] ?? { surface: 'stone', ambience: [] };
}
export function cueCooldown(cue: AudioCue) {
  return cue === 'ui-deny'
    ? 0.5
    : cue.startsWith('step-')
      ? 0.12
      : cue === 'impact' || cue === 'bone'
        ? 0.06
        : 0.04;
}
