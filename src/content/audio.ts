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
const surfaces: Readonly<Record<string, AreaAudio['surface']>> = {
  'outdoor-fixture': 'grass',
  'interior-fixture': 'stone',
  'abandoned-orchard': 'grass',
  'forest-gathering-clearing': 'dirt',
};
export function areaAudio(id: string): AreaAudio {
  return { surface: Object.hasOwn(surfaces, id) ? surfaces[id]! : 'stone', ambience: [] };
}
const cooldowns: Readonly<Record<string, number>> = { 'ui-deny': 0.5, impact: 0.06, bone: 0.06 };
export function cueCooldown(cue: AudioCue) {
  return cooldowns[cue] ?? (cue.startsWith('step-') ? 0.12 : 0.04);
}
