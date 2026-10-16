import type { WorldVisualDefinition } from '../content/world-visuals';
type LightingRig = NonNullable<WorldVisualDefinition['look']>['rig'];
type LookPreset = 'ink' | 'diorama' | 'cinematic';
export type LookSettings = {
  rig: LightingRig;
  look: LookPreset;
  sun?: NonNullable<WorldVisualDefinition['look']>['sun'];
  shadeZones?: NonNullable<WorldVisualDefinition['look']>['shadeZones'];
  baseline: boolean;
  lighting: boolean;
  shadows: boolean;
  atmosphere: boolean;
  postprocessing: boolean;
  paintedValues: boolean;
  groundBounce: boolean;
  tightContacts: boolean;
  strength: number;
  depthOfField: number;
};
// Azimuth stays relative to the locked camera: negative side means screen-left.
export function cameraKeyDirection(
  cameraAzimuth: number,
  elevation: number,
  side = -35,
): readonly [number, number, number] {
  const a = ((cameraAzimuth + side) * Math.PI) / 180,
    e = (elevation * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}
export const lightingRigs = {
  golden: {
    label: 'Golden hour',
    key: 0xffd293,
    sky: 0xbccce5,
    ground: 0xb1b7c1,
    elevation: 42,
    side: -35,
    ambient: 1,
    minimumLight: 0.28,
    keyStrength: 0.95,
    fog: 0xb9a385,
  },
  silver: {
    label: 'Silver hour',
    key: 0xd5e4f3,
    sky: 0xadb9ce,
    ground: 0x99a4bb,
    elevation: 48,
    side: -35,
    ambient: 0.95,
    minimumLight: 0.28,
    keyStrength: 0.45,
    fog: 0x869bab,
  },
  lantern: {
    label: 'Lantern night',
    key: 0xb6c9e2,
    sky: 0x86a8dc,
    ground: 0x768db5,
    elevation: 15,
    side: -35,
    ambient: 0.4,
    minimumLight: 0.06,
    keyStrength: 0.06,
    fog: 0x475568,
  },
} as const;
export const lookPresets = {
  ink: {
    label: 'Atmospheric ink',
    contrast: 1.03,
    saturation: 0.95,
    bloom: 0.24,
    mist: 0.1,
    haze: 0.12,
    shadow: 0.24,
    defocus: 0,
    rim: 0.16,
  },
  diorama: {
    label: 'HD-2D diorama',
    contrast: 1.08,
    saturation: 1.1,
    bloom: 0.48,
    mist: 0.1,
    haze: 0.1,
    shadow: 0.32,
    defocus: 1,
    rim: 0.28,
  },
  cinematic: {
    label: 'Dark cinematic',
    contrast: 1.06,
    saturation: 0.94,
    bloom: 0.18,
    mist: 0.06,
    haze: 0.08,
    shadow: 0.24,
    defocus: 0,
    rim: 0.12,
  },
} as const;
export const defaultLook: LookSettings = {
  rig: 'lantern',
  look: 'cinematic',
  sun: { azimuthDeg: 20, elevationDeg: 15 },
  baseline: false,
  lighting: true,
  shadows: true,
  atmosphere: true,
  postprocessing: true,
  paintedValues: false,
  groundBounce: false,
  tightContacts: false,
  strength: 1,
  depthOfField: 0,
};
export { normalPixels } from '../assets/normal-pixels';
