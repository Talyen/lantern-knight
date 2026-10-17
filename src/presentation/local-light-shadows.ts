import * as T from 'three';
import { cleanupAll, cleanupAfterFailure } from '../assets/cleanup';
import type { IllustratedLighting } from './illustrated-lighting';

// The same five slots drive illumination and shadowing: lantern, three fixtures,
// then the transient ability light. Scene replacement retires their GPU maps.
export class LocalLightShadows {
  readonly lights = Array.from({ length: 5 }, (_, i) => {
    const light = new T.PointLight(0xffffff, 0);
    light.name = 'illustrated-local-' + i;
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.near = 0.05;
    light.shadow.camera.far = 10;
    light.shadow.autoUpdate = false;
    light.visible = light.castShadow = false;
    return light;
  });
  private fallback = new T.WebGLCubeRenderTarget(1);
  private disposed = false;
  constructor(
    scene: T.Scene,
    renderer: T.WebGLRenderer,
    private lighting: IllustratedLighting,
  ) {
    try {
      const texture = new T.CubeDepthTexture(1, T.UnsignedIntType);
      texture.compareFunction = T.LessEqualCompare;
      // Three's cube target supports CubeDepthTexture; its generic target type
      // still narrows this property to a single-face DepthTexture.
      this.fallback.depthTexture = texture as unknown as T.DepthTexture;
      renderer.initRenderTarget(this.fallback);
      for (const [i, light] of this.lights.entries()) {
        scene.add(light);
        Object.defineProperty(lighting.localShadowMaps[i]!, 'value', {
          get: () => light.shadow.map?.depthTexture ?? texture,
        });
      }
    } catch (error) {
      cleanupAfterFailure(error, () => this.dispose());
    }
  }
  update(enabled: boolean) {
    const u = this.lighting.common;
    for (const [i, light] of this.lights.entries()) {
      const active = !this.disposed && enabled && u.inkLightPower.value[i]! > 0;
      // Light/shadow counts participate in Three's shader cache keys, including
      // unlit materials. Keep all five slots admitted while lighting is enabled;
      // a transient burst must not compile a new room-wide shader variant.
      light.visible = light.castShadow = !this.disposed && enabled;
      // Prime every cube during the covered room draw. Thereafter inactive
      // slots retain storage without redrawing; live casters still update fully.
      light.shadow.needsUpdate = active || (enabled && !this.disposed && !light.shadow.map);
      u.inkLocalShadowEnabled.value[i] = active ? 1 : 0;
      light.position.copy(u.inkLightPosition.value[i]!);
      const far = Math.max(0.1, u.inkLightRange.value[i]!);
      if (light.shadow.camera.far !== far) {
        light.shadow.camera.far = far;
        light.shadow.camera.updateProjectionMatrix();
      }
      u.inkLocalShadowFar.value[i] = far;
    }
  }
  reset() {
    this.update(false);
    cleanupAll(
      this.lights.map((light) => () => {
        light.shadow.dispose();
        light.shadow.map = null;
        light.shadow.mapPass = null;
      }),
    );
  }
  bytes() {
    return this.lights.reduce((sum, light) => sum + (light.shadow.map ? 6 * 512 * 512 * 8 : 0), 0);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cleanupAll([
      () => this.reset(),
      () => this.fallback.dispose(),
      ...this.lights.map((light) => () => light.removeFromParent()),
    ]);
  }
}
