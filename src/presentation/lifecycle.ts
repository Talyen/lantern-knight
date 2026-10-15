import type { OrthographicCamera, Texture } from 'three';
import type { AssetPack } from '../assets/loader';
import type { AreaDefinition } from '../content/world';
import type { WorldVisualDefinition } from '../content/world-visuals';
import type { VisualEffects } from '../content/visual-effects';
import type { SimulationView } from '../core/simulation-view';

// Application owns session transactions; presentation owns renderer preparation.
export interface PresentationLifecycle {
  camera: OrthographicCamera;
  generation: number;
  verticalSpan: number;
  readonly depthOfField: number;
  readonly visualEffects: VisualEffects;
  readonly footstepActors?: ReadonlySet<string>;
  setDepthOfField(value: number): void;
  setVisualEffects(value: Partial<VisualEffects>): void;
  resize(scale: number): void;
  loadAnimationFlow(): Promise<void>;
  warm(): Promise<void>;
  warmPack(pack: AssetPack): void;
  prepareAssets(ids?: ReadonlySet<string>): Promise<void>;
  resetRoom(area: AreaDefinition, visuals: WorldVisualDefinition | undefined): void;
  update(sim: SimulationView, alpha: number, ms: number, aim: { x: number; z: number }): void;
  dispose(): void;
}

// The application owns preparation until construction transfers the renderer. Disposal
// always revokes uploads, and destroys the renderer only if it was not transferred.
export type PresentationPreparation<P extends PresentationLifecycle> = {
  create: PresentationFactory<P>;
  prepareTexture: (texture: Texture) => void;
  dispose(): void;
};
export type PresentationFactory<P extends PresentationLifecycle> = {
  (
    canvas: HTMLCanvasElement,
    packs: ReadonlyMap<string, AssetPack>,
    events: import('../core/events').EventHub,
    area: AreaDefinition,
    registration: import('../assets/registration').PreparedRegistration,
    visuals: WorldVisualDefinition | undefined,
    imageRequest: typeof fetch,
  ): P;
  prepare?(canvas: HTMLCanvasElement): PresentationPreparation<P>;
};
