import { assetFilterSchema } from '../assets/asset-browser';
import { z } from 'zod';
import { scenePreviewSchema } from './preview';
import { effectLabels } from '../content/effects-playground';
import { visualEffectLabels } from '../content/visual-effects';
import { animationTreatments } from '../core/animation-treatment';
import { walkTimings } from '../core/locomotion-timing';
import { HEADINGS } from '../core/camera';

export const fixtures = [
  'outdoor-fixture',
  'interior-fixture',
  'systems-fixture',
  'effects-playground',
] as const;
export type Fixture = (typeof fixtures)[number];
export const fixtureNames = ['Outdoor', 'Interior', 'Systems', 'Effects'];
const finite = z.number().finite();
const flags = <T extends Record<string, unknown>>(labels: T) =>
  z.object(
    Object.fromEntries(Object.keys(labels).map((key) => [key, z.boolean()])) as {
      [K in keyof T]: z.ZodBoolean;
    },
  );
const animationSchema = z.object({
  asset: z.string(),
  clip: z.string(),
  heading: z.enum(HEADINGS),
  treatment: z.enum(
    Object.keys(animationTreatments) as [
      keyof typeof animationTreatments,
      ...Array<keyof typeof animationTreatments>,
    ],
  ),
  timing: z.enum(
    Object.keys(walkTimings) as [keyof typeof walkTimings, ...Array<keyof typeof walkTimings>],
  ),
  stabilized: z.boolean(),
  rigidSword: z.boolean(),
  comparison: z.enum(['treatment', 'timing']),
  speed: finite.min(0.25).max(2),
  zoom: finite.min(0.5).max(4),
  paused: z.boolean(),
  time: finite.nonnegative(),
  overlays: z.boolean(),
  background: z.enum(['dark', 'light']),
});
export type AnimationState = z.infer<typeof animationSchema>;
const sceneStateSchema = scenePreviewSchema.extend({
  kind: z.literal('scene'),
  effects: flags(visualEffectLabels),
  effectsBaseline: z.boolean(),
  freeze: z.boolean(),
  collision: z.boolean(),
  animation: animationSchema,
});
export type SceneState = z.infer<typeof sceneStateSchema>;
const effectsStateSchema = z.object({
  kind: z.literal('effects'),
  hero: z.object({ x: finite, z: finite, yaw: finite }),
  scale: z.union([z.literal(1), z.literal(0.75), z.literal(0.5)]),
  freeze: z.boolean(),
  settings: z.object({
    effects: flags(effectLabels),
    treatment: z.enum(['quiet', 'rich']),
    baseline: z.boolean(),
    paused: z.boolean(),
    outline: z.object({
      thickness: finite.min(0.5).max(2),
      opacity: finite.min(0).max(0.5),
      color: z.string().regex(/^#[0-9a-f]{6}$/i),
    }),
  }),
});
export type EffectsState = z.infer<typeof effectsStateSchema>;
type FixtureState = SceneState | EffectsState;
const uiSchema = z.object({
  panel: z.enum(['animation', 'visuals', 'inspect', 'diagnostics']).nullable(),
  hud: z.boolean(),
  hidden: z.boolean(),
  sections: z.record(z.string(), z.boolean()),
  assetFilters: assetFilterSchema.default({
    scope: 'all',
    animated: true,
    type: 'all',
    search: '',
  }),
});
type PreviewUI = z.infer<typeof uiSchema>;
export type Panel = NonNullable<PreviewUI['panel']>;
const workspaceSchema = z.object({
  version: z.literal(2),
  selected: z.enum(fixtures),
  ui: uiSchema,
  scenes: z.partialRecord(
    z.enum(fixtures),
    z.discriminatedUnion('kind', [sceneStateSchema, effectsStateSchema]),
  ),
});
export type Workspace = z.infer<typeof workspaceSchema>;
const workspaceKey = 'lantern-dev-preview-v2';
export function emptyWorkspace(): Workspace {
  return {
    version: 2,
    selected: 'outdoor-fixture',
    scenes: {},
    ui: {
      panel: null,
      hud: false,
      hidden: false,
      sections: {},
      assetFilters: { scope: 'all', animated: true, type: 'all', search: '' },
    },
  };
}
export function readWorkspace(raw: string | null): Workspace {
  try {
    const state = workspaceSchema.parse(JSON.parse(raw ?? 'null'));
    for (const [id, value] of Object.entries(state.scenes)) {
      if (
        (id === 'effects-playground') !== (value.kind === 'effects') ||
        (value.kind === 'scene' && value.scene !== id)
      )
        delete state.scenes[id as Fixture];
    }
    return state;
  } catch {
    return emptyWorkspace();
  }
}
export function createWorkspaceStore(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let state: Workspace;
  try {
    state = readWorkspace(storage.getItem(workspaceKey));
  } catch {
    state = emptyWorkspace();
  }
  return {
    get state() {
      return state;
    },
    save() {
      try {
        storage.setItem(workspaceKey, JSON.stringify(state));
      } catch {
        /* Keep the in-memory workspace usable. */
      }
    },
    reset() {
      state = emptyWorkspace();
      this.save();
    },
  };
}
export type PreviewContext = {
  fixture: Fixture;
  assetToPreview?: string;
  previewAsset(id: string): void;
  remembered?: FixtureState;
  ui: PreviewUI;
  remember(state: FixtureState): void;
  changed(): void;
  select(scene: Fixture): void;
  resetScene(): void;
  resetWorkspace(): void;
};
