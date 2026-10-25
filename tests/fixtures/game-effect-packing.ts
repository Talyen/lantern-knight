import { gpuFixture, T } from './gpu';
import { AssetRuntime } from '../../src/assets/loader';
import { TextureDelivery } from '../../src/assets/texture-delivery';
import { ActorSprite } from '../../src/presentation/sprite';
import {
  packedCombatEffects,
  packedCombatManifest,
  combatEffectCatalog,
} from '../../src/content/combat-feedback';

/** @knip-external Shared by browser and native hardware image proofs. */
export async function gameEffectPackingProof(capture = false) {
  const gpu = gpuFixture(256, 256, 3);
  gpu.scene.background = new T.Color(0x23394e);
  const canvas = document.querySelector('canvas')!;
  const native = new AssetRuntime(
    Object.fromEntries(packedCombatEffects.map((id) => [id, combatEffectCatalog[id]!])),
    undefined,
    undefined,
    undefined,
    new TextureDelivery(canvas, 'source'),
  );
  const packed = new AssetRuntime(
    Object.fromEntries(packedCombatEffects.map((id) => [id, packedCombatManifest(id)])),
    undefined,
    undefined,
    undefined,
    new TextureDelivery(canvas, 'source'),
  );
  const info = gpu.renderer.getContext().getExtension('WEBGL_debug_renderer_info');
  const renderer = info
    ? String(gpu.renderer.getContext().getParameter(info.UNMASKED_RENDERER_WEBGL))
    : 'unavailable';
  let differences = 0,
    maxDifference = 0,
    squaredDifference = 0,
    visibleFrames = 0,
    comparisons = 0;
  const images: { asset: string; before: string; after: string }[] = [];
  const png = (bytes: Uint8Array) => {
    const target = document.createElement('canvas');
    target.width = target.height = 256;
    const context = target.getContext('2d')!;
    const image = context.createImageData(256, 256);
    for (let y = 0; y < 256; y++)
      image.data.set(bytes.subarray(y * 1024, (y + 1) * 1024), (255 - y) * 1024);
    context.putImageData(image, 0, 0);
    return target.toDataURL('image/png').split(',')[1]!;
  };
  try {
    const background = gpu.capture();
    for (const id of packedCombatEffects) {
      console.log('Packing proof: loading ' + id);
      const a = await native.loadPack(id),
        b = await packed.loadPack(id);
      const clip = Object.values(a.manifest.asset.clips).flatMap((headings) =>
        Object.values(headings),
      )[0]!;
      const before = gpu.own(new ActorSprite('native', a.manifest, a.textures, clip));
      const after = gpu.own(new ActorSprite('packed', b.manifest, b.textures, clip));
      gpu.scene.add(before.mesh, after.mesh);
      let bestEnergy = 0;
      const imageIndex = images.length;
      console.log('Packing proof: rendering ' + id);
      for (const scale of [0.7, 1.3]) {
        for (const frame of a.manifest.frames) {
          for (const sprite of [before, after]) {
            sprite.show(frame.id, new T.Vector3(0.013, 0.007, 0), gpu.camera);
            sprite.mesh.scale.setScalar(scale);
          }
          before.mesh.visible = true;
          after.mesh.visible = false;
          const source = gpu.capture();
          before.mesh.visible = false;
          after.mesh.visible = true;
          const candidate = gpu.capture();
          let visible = false,
            energy = 0;
          for (let i = 0; i < source.length; i++) {
            const delta = Math.abs(source[i]! - candidate[i]!);
            if (delta) {
              differences++;
              maxDifference = Math.max(maxDifference, delta);
              squaredDifference += delta * delta;
            }
            if (source[i] !== background[i]) visible = true;
            energy += Math.abs(source[i]! - background[i]!);
          }
          visibleFrames += Number(visible);
          comparisons++;
          if (capture && energy > bestEnergy) {
            images[imageIndex] = { asset: id, before: png(source), after: png(candidate) };
            bestEnergy = energy;
          }
        }
      }
      before.dispose();
      after.dispose();
      a.release();
      b.release();
    }
    return {
      renderer,
      differences,
      maxDifference,
      rmsDifference: Math.sqrt(squaredDifference / (comparisons * 256 * 256 * 4)),
      visibleFrames,
      comparisons,
      images,
    };
  } finally {
    gpu.dispose();
    native.dispose();
    packed.dispose();
  }
}
