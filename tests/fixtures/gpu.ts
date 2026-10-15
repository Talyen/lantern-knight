import * as T from 'three';
import { outward } from '../../src/presentation/camera';
import { DisposalScope, cleanupAfterFailure } from '../../src/assets/cleanup';
/** @knip-external Loaded by the browser GPU probes through Vite. */
export { T };

// Small framebuffer proofs share renderer/camera setup and one GPU lifetime.
// Tests keep their actual materials, geometry, pixel comparisons and thresholds.
/** @knip-external Loaded by the browser GPU probes through Vite. */
export function gpuFixture(width: number, height = width, span = 4) {
  const resources = new DisposalScope();
  const own = <V extends { dispose(): void }>(value: V) => resources.own(value);
  try {
    const renderer = own(
      new T.WebGLRenderer({ canvas: document.querySelector('canvas')!, antialias: false }),
    );
    renderer.setSize(width, height);
    const target = own(new T.WebGLRenderTarget(width, height)),
      scene = new T.Scene();
    const camera = new T.OrthographicCamera(
      (-span * width) / height / 2,
      (span * width) / height / 2,
      span / 2,
      -span / 2,
      0.1,
      100,
    );
    camera.position.copy(outward).multiplyScalar(30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return {
      renderer,
      target,
      scene,
      camera,
      own,
      capture() {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const bytes = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes);
        return bytes;
      },
      dispose: () => resources.dispose(),
    };
  } catch (error) {
    cleanupAfterFailure(error, () => resources.dispose());
  }
}
/** @knip-external Loaded by the browser GPU probes through Vite. */
export { rectangle, groundFixture } from './ground';
