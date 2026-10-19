import { gpuFixture, T } from './gpu';
import { worldVisuals } from '../../src/content/game-content';
import { ShadowProxies } from '../../src/presentation/shadow-proxies';
import { IllustratedLighting } from '../../src/presentation/illustrated-lighting';
import { LocalLightShadows } from '../../src/presentation/local-light-shadows';
import { defaultLook } from '../../src/presentation/lighting-profiles';
import { ActorSprite } from '../../src/presentation/sprite';
import { manifestFixture } from './manifest';
import { CombatFeedback } from '../../src/presentation/combat-feedback';
import { combatEffectAssets } from '../../src/content/combat-feedback';
import { EventHub } from '../../src/core/events';
import { GamePresentation } from '../../src/presentation/game-scene';
import { DisposalScope } from '../../src/assets/cleanup';

/** @knip-external Shared with the native shader preparation proof. */
export async function combatPreparationProof() {
  const gpu = gpuFixture(128),
    { renderer, scene, camera, own } = gpu;
  scene.background = new T.Color(0x113355);
  const manifest = manifestFixture('prepared-effect');
  Object.assign(manifest.asset, {
    type: 'effect',
    renderStyle: 'clean-ink',
    renderCategory: 'cutout',
    canvas: [32, 32],
    anchor: [16, 32],
    density: 32,
  });
  const pixels = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([180, 100, 60, 255], i);
  const texture = own(new T.DataTexture(pixels, 64, 64));
  texture.colorSpace = T.SRGBColorSpace;
  texture.needsUpdate = true;
  const textures = new Map([['atlas-0', texture]]),
    packs = new Map(combatEffectAssets.map((id) => [id, { manifest, textures }])),
    feedback = own(new CombatFeedback(packs, camera, own(new EventHub())));
  const ring = new T.Mesh(
    own(new T.RingGeometry(0.45, 0.5)),
    own(
      new T.MeshBasicMaterial({
        color: 0xf4c575,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    ),
  );
  ring.visible = false;
  scene.add(ring, feedback.group);
  const presentation: GamePresentation = Object.create(GamePresentation.prototype);
  Object.assign(presentation, {
    resources: own(new DisposalScope()),
    packs: new Map(),
    renderer,
    scene,
    camera,
    flare: ring,
    combatFeedback: feedback,
    lookRenderer: { prepare: async () => {} },
    roomPresentation: { surround: { scene: new T.Scene(), update() {}, render() {} } },
    viewTarget: new T.Vector3(),
    visualEffects: { palette: true },
  });
  try {
    const before = gpu.capture();
    // Reproduce the initial asynchronous compilation's different target and
    // light topology, then prime in the actual linear-color render target.
    renderer.setRenderTarget(null);
    await presentation.warm();
    for (let i = 0; i < 5; i++) scene.add(new T.PointLight(0xffffff, 0));
    const primed = gpu.capture();
    const ids = () => renderer.info.programs!.map((program) => program.id).sort((a, b) => a - b);
    let differences = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== primed[i]) differences++;
    const visibleAfterPrime = feedback.group.children.some((mesh) => mesh.visible);
    const extraMeshesAfterPrime = scene.children.filter(
      (mesh) => mesh instanceof T.Mesh && mesh !== ring,
    ).length;
    const effects = () => {
      const programs = [ids()];
      let effectPixels = 0;
      for (let i = 0; i < 2; i++) {
        const active = own(
          new ActorSprite('active:' + i, manifest, textures, manifest.asset.clips.idle!.d45!),
        );
        active.show(manifest.frames[0]!.id, new T.Vector3(), camera);
        scene.add(active.mesh);
        const visible = gpu.capture();
        for (let p = 0; p < visible.length; p += 4) if (visible[p] !== before[p]) effectPixels++;
        programs.push(ids());
        active.dispose();
        gpu.capture();
        programs.push(ids());
      }
      ring.visible = true;
      gpu.capture();
      programs.push(ids());
      ring.visible = false;
      gpu.capture();
      programs.push(ids());
      return { programs, effectPixels };
    };
    const firstEffects = effects();
    feedback.reset();
    const rearmed = feedback.group.children.every((mesh) => mesh.visible);
    for (const light of [...scene.children])
      if (light instanceof T.PointLight) light.removeFromParent();
    renderer.setRenderTarget(null);
    await presentation.warm();
    const afterReset = gpu.capture();
    let resetDifferences = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== afterReset[i]) resetDifferences++;
    const resetHidden = feedback.group.children.every((mesh) => !mesh.visible);
    const resetEffects = effects();
    return {
      differences,
      ...firstEffects,
      visibleAfterPrime,
      extraMeshesAfterPrime,
      reset: { differences: resetDifferences, rearmed, hidden: resetHidden, ...resetEffects },
      error: renderer.getContext().getError(),
    };
  } finally {
    gpu.dispose();
  }
}

/** @knip-external Shared by browser checks and the opt-in native pixel probe. */
export function shadowBatchingProof() {
  const gpu = gpuFixture(256, 256, 32),
    { renderer, scene, camera, own } = gpu;
  const light = own(new IllustratedLighting()),
    local = own(new LocalLightShadows(scene, renderer, light));
  const sun = new T.DirectionalLight(0xffffff, 0);
  sun.castShadow = true;
  sun.position.set(-12, 25, 8);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -25,
    right: 25,
    top: 25,
    bottom: -25,
    near: 0.1,
    far: 80,
  });
  scene.add(sun, sun.target);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  Object.defineProperty(light.common.inkShadowMap, 'value', {
    get: () => sun.shadow.map?.depthTexture ?? null,
  });
  light.common.inkShadowMatrix.value = sun.shadow.matrix;
  const texture = own(new T.DataTexture(new Uint8Array([180, 170, 150, 255]), 1, 1));
  texture.needsUpdate = true;
  const material = own(new T.MeshBasicMaterial({ map: texture, toneMapped: false }));
  light.attach(material, true);
  let referenceLoop = false;
  const compile = material.onBeforeCompile.bind(material),
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (program, renderer) => {
    compile(program, renderer);
    if (!referenceLoop) return;
    const start = program.fragmentShader.indexOf(' for(int i=0;i<5;i++){');
    const end = program.fragmentShader.indexOf('\n illumination*=inkShade();', start);
    if (start < 0 || end < start) throw new Error('Missing light loop');
    program.fragmentShader =
      program.fragmentShader.slice(0, start) +
      ' for(int i=0;i<5;i++){vec3 delta=inkLightPosition[i]-receiver;float d=length(delta);float falloff=pow(max(0.0,1.0-d/max(.1,inkLightRange[i])),2.0);local+=inkLightColor[i]*inkLightPower[i]*falloff*(.35+.65*max(0.0,dot(n,normalize(delta+vec3(.0001)))))*inkLocalVisibility(i,receiver,receiverNormal);}' +
      program.fragmentShader.slice(end);
  };
  material.customProgramCacheKey = () => key + ':reference-loop:' + referenceLoop;
  const floor = new T.Mesh(own(new T.PlaneGeometry(60, 60)), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  scene.add(floor);
  const results = [];
  try {
    for (const [area, art] of Object.entries(worldVisuals)) {
      const ground = art.groundInteraction!;
      const batch = new ShadowProxies(sun, local.lights),
        single = new ShadowProxies(sun, local.lights);
      batch.build({ ...art, props: [] }, []);
      // The reference reproduces the old one-mesh-per-contour submission with
      // exactly the same shape triangulation and authored depth calculation.
      single.build(
        {
          ...art,
          props: [],
          groundInteraction: {
            ...ground,
            regions: ground.regions.flatMap((r) =>
              (r.mask ?? []).map((mask) => ({ ...r, mask: [mask] })),
            ),
          },
        },
        [],
      );
      const counts = {
        before: single.proxies.children.length,
        after: batch.proxies.children.length,
      };
      let differences = 0,
        lightDifferences = 0;
      for (const position of [
        [2, 1, 4],
        [-4, 2, -3],
        [8, 1, 7],
        [80, 1, -3],
      ]) {
        light.configure({ ...defaultLook, rig: 'silver', atmosphere: false }, new T.Vector3());
        light.common.inkDirection.value.copy(sun.position).normalize();
        light.common.inkShadowEnabled.value = 1;
        light.common.inkLightPower.value.fill(0);
        light.common.inkLightPower.value[0] = 2;
        light.common.inkLightPosition.value[0]!.set(position[0]!, position[1]!, position[2]!);
        light.common.inkLightRange.value[0] = 9;
        local.update(true);
        scene.add(single.proxies);
        const before = gpu.capture();
        scene.remove(single.proxies);
        scene.add(batch.proxies);
        local.update(true);
        const after = gpu.capture();
        scene.remove(batch.proxies);
        for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) differences++;
        scene.add(batch.proxies);
        referenceLoop = true;
        material.needsUpdate = true;
        const unculled = gpu.capture();
        for (let i = 0; i < after.length; i++) if (after[i] !== unculled[i]) lightDifferences++;
        referenceLoop = false;
        material.needsUpdate = true;
        scene.remove(batch.proxies);
      }
      results.push({ area, ...counts, differences, lightDifferences });
      single.reset();
      batch.reset();
    }
    floor.visible = false;
    sun.visible = false;
    local.update(false);
    renderer.shadowMap.enabled = false;
    Object.assign(camera, { left: -2, right: 2, top: 2, bottom: -2 });
    camera.updateProjectionMatrix();
    const manifest = manifestFixture('pose-proof');
    manifest.asset.canvas = [32, 32];
    manifest.asset.anchor = [16, 32];
    manifest.asset.density = 32;
    manifest.asset.renderStyle = 'clean-ink';
    manifest.asset.renderCategory = 'cutout';
    manifest.pages[0]!.width = manifest.pages[0]!.height = 32;
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 2; y < 30; y++)
      for (let x = 2; x < 30; x++)
        pixels.set([180, 100, 60, x < 4 || y < 4 ? 170 : 255], (y * 32 + x) * 4);
    const map = own(new T.DataTexture(pixels, 32, 32));
    map.needsUpdate = true;
    const maps = new Map([['atlas-0', map]]);
    const reference = own(
      new ActorSprite(
        'reference',
        { ...manifest, asset: { ...manifest.asset, type: 'prop' } },
        maps,
        manifest.asset.clips.idle!.d45!,
      ),
    );
    reference.manifest = manifest;
    const prepared = own(
      new ActorSprite('prepared', manifest, maps, manifest.asset.clips.idle!.d45!),
    );
    reference.show(manifest.frames[0]!.id, new T.Vector3(), camera);
    prepared.show(manifest.frames[0]!.id, new T.Vector3(), camera);
    scene.add(reference.mesh);
    const held = gpu.capture();
    scene.remove(reference.mesh);
    scene.add(prepared.mesh);
    const warmed = gpu.capture();
    scene.remove(prepared.mesh);
    let poseDifferences = 0,
      posePixels = 0;
    for (let i = 0; i < held.length; i++) {
      if (held[i] !== warmed[i]) poseDifferences++;
      if (i % 4 === 0 && held[i]! > 0) posePixels++;
    }
    return {
      results,
      poseDifferences,
      posePixels,
      error: renderer.getContext().getError(),
      gpu: String(
        renderer
          .getContext()
          .getParameter(
            renderer.getContext().getExtension('WEBGL_debug_renderer_info')!
              .UNMASKED_RENDERER_WEBGL,
          ),
      ),
    };
  } finally {
    sun.shadow.dispose();
    gpu.dispose();
  }
}
