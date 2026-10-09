import type { PresentationLifecycle } from '../presentation/lifecycle';
import type { EffectsPlayground } from '../presentation/effects-playground';
import type { PlaygroundSettings } from '../content/effects-playground';
import { defaultVisualEffects, type VisualEffects } from '../content/visual-effects';
import type { Simulation } from '../core/simulation';
import { outward } from '../core/camera';

// Application owns input, scheduling and asset leases; this adapter owns only the renderer.
export class EffectsPresentation implements PresentationLifecycle {
  generation = 0;
  verticalSpan = 9;
  readonly depthOfField = 0;
  readonly visualEffects = defaultVisualEffects();
  readonly camera;
  constructor(
    readonly view: EffectsPlayground,
    private settings: PlaygroundSettings,
  ) {
    this.camera = view.camera;
    this.camera.position.set(0, 0, 0).addScaledVector(outward, 30);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }
  setDepthOfField() {}
  setVisualEffects(value: Partial<VisualEffects>) {
    Object.assign(this.settings.effects, value);
  }
  resize(scale = 1) {
    this.view.resize(scale);
  }
  async loadAnimationFlow() {}
  warm() {
    return this.view.prepare();
  }
  warmPack() {}
  async prepareAssets() {}
  resetRoom() {}
  update(sim: Simulation, alpha: number, ms: number) {
    this.view.draw(sim, alpha, Math.min(100, ms), this.settings);
  }
  dispose() {
    this.view.dispose();
  }
}
