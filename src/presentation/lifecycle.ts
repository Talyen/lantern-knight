import type { OrthographicCamera } from 'three';
import type { AssetPack } from '../assets/loader';
import type { AreaDefinition } from '../content/world';
import type { WorldVisualDefinition } from '../content/world-visuals';
import type { VisualEffects } from '../content/visual-effects';
import type { Simulation } from '../core/simulation';

// Application owns session transactions; presentation owns renderer preparation.
export interface PresentationLifecycle {
  camera: OrthographicCamera;
  generation: number;
  verticalSpan: number;
  readonly depthOfField: number;
  readonly visualEffects: VisualEffects;
  setDepthOfField(value: number): void;
  setVisualEffects(value: Partial<VisualEffects>): void;
  resize(scale: number): void;
  loadAnimationFlow(): Promise<void>;
  warm(): Promise<void>;
  warmPack(pack: AssetPack): void;
  prepareAssets(ids?: ReadonlySet<string>): Promise<void>;
  resetRoom(area: AreaDefinition, visuals: WorldVisualDefinition | undefined): void;
  update(sim: Simulation, alpha: number, ms: number, aim: { x: number; z: number }): void;
  dispose(): void;
}
