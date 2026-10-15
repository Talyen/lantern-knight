import { test, expect } from './fixtures';
import { crateOcclusionFixture } from '../fixtures/crate-occlusion';

test('ground atlas masks each actor independently and draws hidden outline pixels', async ({
  page,
}) => {
  await page.route('**/ground-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/ground-proof.html');
  const proof = await page.evaluate(async () => {
    const threePath = '/node_modules/.vite/deps/three.js',
      occlusionPath = '/src/presentation/ground-occlusion.ts',
      cameraPath = '/src/presentation/camera.ts';
    const T = await import(threePath),
      { GroundOcclusion } = await import(occlusionPath),
      { outward, right, up } = await import(cameraPath);
    const renderer = new T.WebGLRenderer({
      canvas: document.querySelector('canvas')!,
      antialias: false,
    });
    renderer.setSize(96, 96);
    renderer.setClearColor(0);
    const target = new T.WebGLRenderTarget(96, 96),
      camera = new T.OrthographicCamera(-2, 2, 2, -2, 0.1, 100),
      scene = new T.Scene();
    camera.position.copy(outward).multiplyScalar(30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const ground = {
      asset: 'fixture',
      frame: 'fixture',
      hash: 'a'.repeat(64),
      dimensions: [64, 64],
      destinations: [],
      regions: [
        {
          id: 'canopy',
          name: 'Canopy',
          mask: [
            {
              outer: [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
              holes: [],
            },
          ],
          depth: { kind: 'anchor', point: { x: 0, z: 0 } },
        },
      ],
    };
    const atlas = new GroundOcclusion(ground, 4, 4, renderer.capabilities.maxTextureSize);
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let y = 3; y < 13; y++)
      for (let x = 3; x < 13; x++) pixels.fill(255, (y * 16 + x) * 4, (y * 16 + x + 1) * 4);
    const texture = new T.DataTexture(pixels, 16, 16);
    texture.needsUpdate = true;
    texture.magFilter = texture.minFilter = T.NearestFilter;
    const sprites = [-1, 1].map((side) => {
      const material = new T.MeshBasicMaterial({
          map: texture,
          alphaTest: 0.05,
          toneMapped: false,
        }),
        geometry = new T.PlaneGeometry(1.5, 1.5),
        mesh = new T.Mesh(geometry, material);
      mesh.position.copy(right).multiplyScalar(side * 0.85);
      mesh.quaternion.copy(camera.quaternion);
      scene.add(mesh);
      return { material, mesh, geometry };
    });
    atlas.attach(sprites[0], 'hero');
    atlas.attach(sprites[1], 'enemy');
    const render = (hero: number, enemy: number, outlines: boolean) => {
      atlas.outlines = outlines;
      atlas.update(sprites[0], hero, hero);
      atlas.update(sprites[1], enemy, enemy);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const out = new Uint8Array(96 * 96 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 96, 96, out);
      let left = 0,
        right = 0,
        gold = 0,
        brick = 0;
      for (let y = 0; y < 96; y++)
        for (let x = 0; x < 96; x++) {
          const i = (y * 96 + x) * 4,
            r = out[i]!,
            g = out[i + 1]!,
            b = out[i + 2]!;
          if (r + g + b > 0) {
            if (x < 48) left++;
            else right++;
            if (r > g && g > b) gold++;
            if (r > g && b > g * 0.7) brick++;
          }
        }
      return { left, right, gold, brick };
    };
    try {
      const proof = {
        front: render(1, 1, false),
        hidden: render(-1, -1, false),
        opposite: render(-1, 1, false),
        outlined: render(-1, -1, true),
        bytes: atlas.bytes,
      };
      // An asymmetric mask catches top-left image / bottom-left texture inversion.
      for (const point of ground.regions[0]!.mask[0]!.outer) if (point[1] === 1) point[1] = 0.5;
      const upperAtlas = new GroundOcclusion(ground, 4, 4, renderer.capabilities.maxTextureSize);
      atlas.uniforms.groundAtlas.value = upperAtlas.texture;
      for (const s of sprites) s.mesh.position.addScaledVector(up, 0.9);
      const upperHidden = render(-1, -1, false);
      for (const s of sprites) s.mesh.position.addScaledVector(up, -1.8);
      const lowerVisible = render(-1, -1, false);
      upperAtlas.dispose();
      atlas.uniforms.groundAtlas.value = atlas.texture;
      for (const s of sprites) s.mesh.visible = false;
      const dropMaterial = new T.MeshBasicMaterial({
        map: texture,
        alphaTest: 0.05,
        toneMapped: false,
      });
      const drop = {
        material: dropMaterial,
        geometry: sprites[0]!.geometry,
        mesh: new T.Mesh(sprites[0]!.geometry, dropMaterial),
      };
      drop.mesh.quaternion.copy(camera.quaternion);
      scene.add(drop.mesh);
      atlas.attach(drop, 'drop');
      atlas.update(drop, -1, -1);
      const dropHidden = render(-1, -1, true);
      atlas.update(drop, 1, 1);
      const dropFront = render(-1, -1, true);
      dropMaterial.dispose();
      scene.remove(drop.mesh);
      const propMaterial = new T.MeshBasicMaterial({
        map: texture,
        alphaTest: 0.05,
        toneMapped: false,
      });
      const prop = {
        material: propMaterial,
        geometry: sprites[0]!.geometry,
        mesh: new T.Mesh(sprites[0]!.geometry, propMaterial),
      };
      prop.mesh.quaternion.copy(camera.quaternion);
      scene.add(prop.mesh);
      atlas.attach(prop, 'prop');
      atlas.update(prop, -1, -1);
      const propHidden = render(-1, -1, true);
      atlas.update(prop, 1, 1);
      const propFront = render(-1, -1, true);
      propMaterial.dispose();
      scene.remove(prop.mesh);
      return { ...proof, upperHidden, lowerVisible, dropHidden, dropFront, propHidden, propFront };
    } finally {
      atlas.dispose();
      for (const s of sprites) {
        s.material.dispose();
        s.geometry.dispose();
      }
      texture.dispose();
      target.dispose();
      renderer.dispose();
    }
  });
  expect(proof.front.left).toBeGreaterThan(300);
  expect(proof.front.right).toBeGreaterThan(300);
  expect(proof.hidden.left + proof.hidden.right).toBe(0);
  expect(proof.opposite.left).toBe(0);
  expect(proof.opposite.right).toBeGreaterThan(300);
  expect(proof.outlined.left).toBeGreaterThan(0);
  expect(proof.outlined.right).toBeGreaterThan(0);
  expect(proof.outlined.left).toBeLessThan(proof.front.left);
  expect(proof.outlined.gold).toBeGreaterThan(0);
  expect(proof.outlined.brick).toBeGreaterThan(0);
  expect(proof.bytes).toBe(64 * 64 * 4);
  expect(proof.dropHidden.left + proof.dropHidden.right).toBe(0);
  expect(proof.dropFront.left + proof.dropFront.right).toBeGreaterThan(300);
  expect(proof.propHidden.left + proof.propHidden.right).toBe(0);
  expect(proof.propFront.left + proof.propFront.right).toBeGreaterThan(300);
  expect(proof.upperHidden.left + proof.upperHidden.right).toBe(0);
  expect(proof.lowerVisible.left).toBeGreaterThan(300);
  expect(proof.lowerVisible.right).toBeGreaterThan(300);
});

// Authored regression: the rear orchard crate used its neighbors' foreground depth.
test('a repaired crate contact boundary removes false foreground strips and retains behind occlusion', async ({
  page,
}) => {
  const { auditGroundOcclusion, contactDepthRepair } =
    await import('../../tools/diagnostics/ground-occlusion-audit');
  const { document: sceneDocument, crate: region } = crateOcclusionFixture();
  const witness = auditGroundOcclusion(sceneDocument).find(
    (f) => f.region === region.id && f.kind === 'depth-below-silhouette',
  )!.witness!;
  const repaired = contactDepthRepair(sceneDocument, region.id);
  await page.route('**/crate-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/crate-proof.html');
  const proof = await page.evaluate(
    async ({ ground, width, height, repaired, witness }) => {
      const threePath = '/node_modules/.vite/deps/three.js',
        occlusionPath = '/src/presentation/ground-occlusion.ts',
        cameraPath = '/src/presentation/camera.ts',
        layoutPath = '/src/content/floor-layout.ts';
      const T = await import(threePath),
        { GroundOcclusion } = await import(occlusionPath),
        { outward, up } = await import(cameraPath),
        { artworkFloorLayout } = await import(layoutPath);
      const renderer = new T.WebGLRenderer({
        canvas: document.querySelector('canvas')!,
        antialias: false,
      });
      renderer.setSize(128, 128);
      renderer.setClearColor(0);
      const target = new T.WebGLRenderTarget(128, 128),
        camera = new T.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.1, 100),
        scene = new T.Scene(),
        texture = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
        material = new T.MeshBasicMaterial({ map: texture, color: 0xffffff, toneMapped: false }),
        geometry = new T.PlaneGeometry(0.9, 1.8),
        mesh = new T.Mesh(geometry, material);
      texture.needsUpdate = true;
      scene.add(mesh);
      // Modest atlas resolution keeps this focused GPU proof independent of production textures.
      ground.dimensions = [1024, 683];
      const before = new GroundOcclusion(
        ground,
        width,
        height,
        renderer.capabilities.maxTextureSize,
      );
      const after = new GroundOcclusion(
        { ...ground, regions: [{ ...ground.regions[0], depth: repaired }] },
        width,
        height,
        renderer.capabilities.maxTextureSize,
      );
      const actor = { material };
      before.attach(actor, 'hero');
      before.outlines = false;
      const layout = artworkFloorLayout(width, height);
      const render = (uv: number[], texture: typeof before.texture) => {
        const point = layout.world(uv),
          foot = new T.Vector3(point.x, 0, point.z),
          center = foot.clone().addScaledVector(up, 0.9);
        mesh.position.copy(center);
        camera.position.copy(center).addScaledVector(outward, 30);
        camera.lookAt(center);
        camera.updateMatrixWorld();
        mesh.quaternion.copy(camera.quaternion);
        before.update(actor, point.x, point.z);
        before.uniforms.groundAtlas.value = texture;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(128 * 128 * 4);
        renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
        let visible = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 200) visible++;
        return visible;
      };
      try {
        const front = [witness.u, witness.v],
          behind = [0.57, 0.24];
        return {
          beforeFront: render(front, before.texture),
          afterFront: render(front, after.texture),
          beforeSliver: render([0.578, 0.286], before.texture),
          afterSliver: render([0.578, 0.286], after.texture),
          beforeBehind: render(behind, before.texture),
          afterBehind: render(behind, after.texture),
        };
      } finally {
        before.dispose();
        after.dispose();
        geometry.dispose();
        material.dispose();
        texture.dispose();
        target.dispose();
        renderer.dispose();
      }
    },
    {
      ground: { ...sceneDocument.groundInteraction!, regions: [region] },
      width: sceneDocument.floor.width,
      height: sceneDocument.floor.depth,
      repaired,
      witness,
    },
  );
  expect(proof.afterFront).toBeGreaterThan(proof.beforeFront + 100);
  expect(proof.afterSliver).toBeGreaterThan(proof.beforeSliver + 20);
  expect(proof.afterBehind).toBeLessThan(proof.afterFront - 100);
  expect(proof.beforeBehind).toBeLessThan(proof.afterFront - 100);
});

test('ground shadows preserve black ink and mask painted scenery for actors, instances and cast receivers', async ({
  page,
}) => {
  await page.route('**/shadow-ground-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/shadow-ground-proof.html');
  const proof = await page.evaluate(async () => {
    const threePath = '/node_modules/.vite/deps/three.js',
      atlasPath = '/src/presentation/ground-occlusion.ts',
      contactPath = '/src/presentation/contact-shadows.ts',
      multiplyPath = '/src/presentation/ground-shadow-material.ts',
      cameraPath = '/src/presentation/camera.ts';
    const T = await import(threePath),
      { GroundOcclusion } = await import(atlasPath),
      { contactShadowMaterial } = await import(contactPath),
      { multiplyGroundShadow } = await import(multiplyPath),
      { outward } = await import(cameraPath);
    const renderer = new T.WebGLRenderer({ canvas: document.querySelector('canvas')! });
    renderer.setSize(96, 96);
    renderer.shadowMap.enabled = true;
    const target = new T.WebGLRenderTarget(96, 96),
      scene = new T.Scene(),
      camera = new T.OrthographicCamera(-2, 2, 2, -2, 0.1, 100),
      groundMaterial = new T.MeshBasicMaterial({ color: 0xb0a080, toneMapped: false }),
      geometry = new T.PlaneGeometry(6, 6),
      floor = new T.Mesh(geometry, groundMaterial),
      texture = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    camera.position.copy(outward).multiplyScalar(30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const atlas = new GroundOcclusion(
      {
        asset: 'fixture',
        frame: 'fixture',
        hash: 'a'.repeat(64),
        dimensions: [64, 64],
        destinations: [],
        regions: [
          {
            id: 'wall',
            name: 'Painted wall',
            mask: [
              {
                outer: [
                  [0, 0],
                  [0.5, 0],
                  [0.5, 1],
                  [0, 1],
                ],
                holes: [],
              },
            ],
            depth: { kind: 'anchor', point: { x: 0, z: 0 } },
          },
        ],
      },
      4,
      4,
      renderer.capabilities.maxTextureSize,
    );
    const capture = () => {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(96 * 96 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 96, 96, pixels);
      return pixels;
    };
    const changed = (a: Uint8Array, b: Uint8Array) => {
      let left = 0,
        right = 0,
        brightened = 0;
      for (let i = 0; i < a.length; i += 4) {
        const delta = a[i]! + a[i + 1]! + a[i + 2]! - b[i]! - b[i + 1]! - b[i + 2]!;
        if (delta > 3) {
          if ((i / 4) % 96 < 48) left++;
          else right++;
        }
        if (delta < -3) brightened++;
      }
      return { left, right, brightened };
    };
    const material = contactShadowMaterial(texture, 0.5),
      actor = new T.Mesh(new T.PlaneGeometry(3, 3), material);
    actor.rotation.x = -Math.PI / 2;
    actor.position.y = 0.03;
    const baseline = capture();
    scene.add(actor);
    const unmasked = capture();
    groundMaterial.color.set(0);
    const blackBaseline = (() => {
      actor.visible = false;
      const p = capture();
      actor.visible = true;
      return p;
    })();
    const black = capture();
    groundMaterial.color.set(0xb0a080);
    atlas.attachShadow(material);
    const masked = capture();
    scene.remove(actor);
    // Translation in instanceMatrix must participate in artwork registration.
    const instances = new T.InstancedMesh(
      new T.PlaneGeometry(1.5, 1.5),
      contactShadowMaterial(texture, 0.5),
      2,
    );
    for (const [i, side] of [-1, 1].entries()) {
      const pose = new T.Object3D();
      pose.position.set(side * 0.8, 0.03, -side * 0.8);
      pose.rotation.x = -Math.PI / 2;
      pose.updateMatrix();
      instances.setMatrixAt(i, pose.matrix);
    }
    atlas.attachShadow(instances.material);
    scene.add(instances);
    const instanced = capture();
    scene.remove(instances);
    const receiverMaterial = multiplyGroundShadow(
        new T.ShadowMaterial({ opacity: 0.5, toneMapped: false }),
      ),
      receiver = new T.Mesh(geometry.clone(), receiverMaterial),
      caster = new T.Mesh(new T.BoxGeometry(3, 0.2, 3), new T.MeshBasicMaterial()),
      sun = new T.DirectionalLight(0xffffff, 1);
    receiver.rotation.x = -Math.PI / 2;
    receiver.position.y = 0.02;
    receiver.receiveShadow = true;
    caster.position.y = 1;
    caster.castShadow = true;
    caster.material.colorWrite = false;
    sun.position.set(0, 8, 0);
    sun.castShadow = true;
    scene.add(sun, sun.target, receiver, caster);
    const cast = capture();
    atlas.attachShadow(receiverMaterial);
    const maskedCast = capture();
    const result = {
      unmasked: changed(baseline, unmasked),
      black: changed(blackBaseline, black),
      masked: changed(baseline, masked),
      instanced: changed(baseline, instanced),
      cast: changed(baseline, cast),
      maskedCast: changed(baseline, maskedCast),
      error: renderer.getContext().getError(),
    };
    for (const mesh of [actor, instances, receiver, caster]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    geometry.dispose();
    groundMaterial.dispose();
    texture.dispose();
    atlas.dispose();
    sun.shadow.dispose();
    target.dispose();
    renderer.dispose();
    return result;
  });
  expect(proof.error).toBe(0);
  expect(proof.black.brightened).toBe(0);
  expect(proof.unmasked.left).toBeGreaterThan(100);
  expect(proof.unmasked.right).toBeGreaterThan(100);
  for (const pixels of [proof.masked, proof.instanced, proof.maskedCast]) {
    expect(pixels.left).toBe(0);
    expect(pixels.right).toBeGreaterThan(100);
    expect(pixels.brightened).toBe(0);
  }
  expect(proof.cast.left).toBeGreaterThan(100);
});
