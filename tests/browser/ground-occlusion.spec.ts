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
      return { ...proof, upperHidden, lowerVisible };
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
