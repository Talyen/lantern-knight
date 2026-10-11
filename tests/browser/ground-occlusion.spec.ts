import { test, expect } from './fixtures';

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
      cameraPath = '/src/core/camera.ts';
    const T = await import(threePath),
      { GroundOcclusion } = await import(occlusionPath),
      { outward, right } = await import(cameraPath);
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
      return {
        front: render(1, 1, false),
        hidden: render(-1, -1, false),
        opposite: render(-1, 1, false),
        outlined: render(-1, -1, true),
        bytes: atlas.bytes,
      };
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
});
