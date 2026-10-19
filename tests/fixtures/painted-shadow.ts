import { gpuFixture, T } from './gpu';
import { worldVisuals } from '../../src/content/game-content';
import { artworkFloorLayout } from '../../src/content/floor-layout';
import {
  paintedHeightByte,
  PAINTED_HEIGHT_RANGE,
  type MaskShape,
} from '../../src/content/ground-interaction';
import { GroundOcclusion, regionDepth } from '../../src/presentation/ground-occlusion';
import { ShadowProxies } from '../../src/presentation/shadow-proxies';
import { IllustratedLighting } from '../../src/presentation/illustrated-lighting';
import { LocalLightShadows } from '../../src/presentation/local-light-shadows';
import { defaultLook } from '../../src/presentation/lighting-profiles';
import { outward } from '../../src/presentation/camera';
import { maskIntervals } from '../../tools/diagnostics/ground-occlusion-audit';

/** @knip-external Loaded by the browser regression through Vite. */
export function paintedShadowProof() {
  const art = worldVisuals['forest-gathering-clearing']!,
    floor = art.editorFloor!,
    region = art.groundInteraction!.regions.find((r) => r.id === 'clearing-structure-4')!,
    mask = structuredClone(region.mask!) as MaskShape[],
    ground = { ...art.groundInteraction!, regions: [region] },
    layout = artworkFloorLayout(floor.width, floor.depth),
    gpu = gpuFixture(384, 384, 6),
    { renderer, scene, camera, own } = gpu;
  try {
    const center = layout.world([0.46, 0.64]);
    camera.position.add(new T.Vector3(center.x, 0, center.z));
    camera.lookAt(center.x, 0, center.z);
    camera.updateMatrixWorld();
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    const lighting = own(new IllustratedLighting()),
      local = own(new LocalLightShadows(scene, renderer, lighting)),
      atlas = own(
        new GroundOcclusion(ground, floor.width, floor.depth, renderer.capabilities.maxTextureSize),
      ),
      proxies = new ShadowProxies(new T.DirectionalLight(), local.lights);
    own({ dispose: () => proxies.reset() });
    proxies.build({ ...art, props: [], groundInteraction: ground }, []);
    scene.add(proxies.proxies);
    const material = own(new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    lighting.attach(material, true);
    const compile = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (s, r) => {
      compile(s, r);
      s.fragmentShader = s.fragmentShader.replace(
        ' if(inkEnabled<.5)return base*',
        ' return vec3(inkLocalVisibility(0,receiver,receiverNormal));\n if(inkEnabled<.5)return base*',
      );
    };
    material.customProgramCacheKey = () => 'painted-shadow-visibility-proof';
    const mesh = new T.Mesh(own(new T.PlaneGeometry(80, 80)), material);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    lighting.setGroundOcclusion(atlas, floor);
    lighting.configure({ ...defaultLook, rig: 'silver', atmosphere: false }, new T.Vector3());
    lighting.common.inkShadowEnabled.value = 0;
    lighting.common.inkLightPower.value.fill(0);
    lighting.common.inkLightPower.value[0] = 2.4;
    lighting.common.inkLightRange.value[0] = 6.8;
    const ceiling = (paintedHeightByte(region) / 255) * PAINTED_HEIGHT_RANGE;
    const failures: unknown[] = [];
    let checked = 0,
      shadowed = 0;
    for (const uv of [
      [0.53, 0.73],
      [0.32, 0.73],
      [0.55, 0.56],
    ]) {
      const source = layout.world(uv);
      const light = lighting.common.inkLightPosition.value[0]!;
      light.set(source.x, 0.455, source.z);
      local.update(true);
      const pixels = gpu.capture();
      for (let u = 0.35; u < 0.53; u += 0.012)
        for (let v = 0.54; v < 0.69; v += 0.012) {
          if (!maskIntervals(mask, u).some(([a, b]) => v > a + 0.004 && v < b - 0.004)) continue;
          const point = layout.world([u, v]),
            base = new T.Vector3(point.x, 0, point.z),
            lift = Math.max(
              0,
              (regionDepth(region, u, layout) - base.x * outward.x - base.z * outward.z) /
                (outward.x ** 2 + outward.z ** 2),
            );
          if (lift * outward.y < ceiling + 0.08) continue;
          const receiver = base.addScaledVector(outward, ceiling / outward.y),
            biased = receiver.clone().add(new T.Vector3(0, 0.035, 0)),
            ray = new T.Raycaster(
              light,
              biased.clone().sub(light).normalize(),
              0,
              light.distanceTo(biased) - 0.03,
            );
          if (ray.intersectObjects(proxies.proxies.children).length) {
            shadowed++;
            continue;
          }
          const screen = base.clone().project(camera),
            x = Math.floor((screen.x + 1) * 192),
            y = Math.floor((screen.y + 1) * 192);
          if (x < 0 || x >= 384 || y < 0 || y >= 384) continue;
          checked++;
          const visibility = pixels[(y * 384 + x) * 4]!;
          if (visibility < 190) failures.push({ u, v, light: uv, visibility });
        }
    }
    return { checked, shadowed, failures, error: renderer.getContext().getError() };
  } finally {
    gpu.dispose();
  }
}
