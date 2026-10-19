import { test, expect } from './fixtures';

test('centered outlines keep a four CSS pixel stroke across zoom, mirroring and pixel ratio, and obey scenery', async ({
  page,
}) => {
  await page.route('**/outline-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/outline-proof.html');
  const proof = await page.evaluate(async () => {
    const gpuPath = '/tests/fixtures/gpu.ts',
      outlinePath = '/src/presentation/sprite-outline.ts',
      groundPath = '/src/presentation/ground-occlusion.ts';
    const { T, gpuFixture, groundFixture, rectangle } = await import(gpuPath);
    const { SpriteOutline } = await import(outlinePath),
      { GroundOcclusion } = await import(groundPath);
    const gpu = gpuFixture(96),
      { renderer, scene, camera, own } = gpu;
    renderer.setClearColor(0xb0b0b0);
    const data = new Uint8Array(32 * 16 * 4);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 32; x++)
        if (x >= 16 || (x >= 4 && x < 12 && y >= 4 && y < 12))
          data.fill(255, (y * 32 + x) * 4, (y * 32 + x + 1) * 4);
    const texture = own(new T.DataTexture(data, 32, 16));
    texture.needsUpdate = true;
    texture.minFilter = texture.magFilter = T.NearestFilter;
    const geometry = own(new T.PlaneGeometry(2, 2)),
      uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5);
    uv.needsUpdate = true;
    const material = own(
      new T.MeshBasicMaterial({
        map: texture,
        alphaTest: 0.05,
        transparent: true,
        toneMapped: false,
      }),
    );
    const mesh = new T.Mesh(geometry, material);
    mesh.quaternion.copy(camera.quaternion);
    scene.add(mesh);
    const outline = new SpriteOutline(geometry, false);
    outline.attach(material);
    mesh.onBeforeRender = () => outline.update(renderer, mesh);
    const capture = () => {
      renderer.setRenderTarget(gpu.target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(gpu.target.width * gpu.target.height * 4);
      renderer.readRenderTargetPixels(
        gpu.target,
        0,
        0,
        gpu.target.width,
        gpu.target.height,
        pixels,
      );
      return pixels;
    };
    const metrics = (image: Uint8Array, width: number) => {
      const row = Math.floor(image.length / 4 / width / 2),
        white: number[] = [],
        black: number[] = [];
      for (let x = 0; x < width; x++) {
        const i = (row * width + x) * 4;
        if (image[i]! > 220) white.push(x);
        if (image[i]! < 25) black.push(x);
      }
      const all = [...white, ...black];
      return {
        left: Math.min(...all),
        right: Math.max(...all),
        black: black.length,
        white: white.length,
      };
    };
    try {
      const cases = [];
      for (const [ratio, zoom, scale] of [
        [1, 1, 1],
        [1, 2, -1.4],
        [2, 1, 1],
      ] as const) {
        renderer.setPixelRatio(ratio);
        renderer.setSize(96, 96);
        gpu.target.setSize(96 * ratio, 96 * ratio);
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        mesh.scale.set(scale, Math.abs(scale), 1);
        outline.enabled = false;
        const base = metrics(capture(), 96 * ratio);
        outline.enabled = true;
        const outlined = metrics(capture(), 96 * ratio);
        cases.push({ ratio, base, outlined });
      }
      renderer.setPixelRatio(1);
      renderer.setSize(96, 96);
      gpu.target.setSize(96, 96);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      mesh.scale.set(1, 1, 1);
      material.map = null;
      material.needsUpdate = true;
      capture();
      material.map = texture;
      material.needsUpdate = true;
      // Production artwork uses linear alpha sampling; use that for the hidden
      // contour's fractional 1.5 px neighborhood after the integer width proof.
      texture.minFilter = texture.magFilter = T.LinearFilter;
      texture.needsUpdate = true;
      const ground = groundFixture([
        {
          id: 'cover',
          name: 'Cover',
          mask: [{ outer: rectangle(0, 0, 1, 1), holes: [] }],
          depth: { kind: 'anchor', point: { x: 0, z: 0 } },
        },
      ]);
      const atlas = own(new GroundOcclusion(ground, 4, 4, renderer.capabilities.maxTextureSize));
      const sprite = { mesh, material, geometry };
      atlas.attach(sprite, 'hero');
      atlas.update(sprite, -1, -1);
      const hidden: number[][] = [];
      for (const enabled of [false, true]) {
        outline.enabled = enabled;
        atlas.outlines = true;
        hidden.push([...capture()]);
      }
      atlas.outlines = false;
      atlas.update(sprite, -1, -1);
      const hiddenOff = [...capture()];
      mesh.visible = false;
      const background = [...capture()];
      return {
        cases,
        hiddenEqual: hidden[0]!.every((v, i) => v === hidden[1]![i]),
        hiddenOffEqual: hiddenOff.every((v, i) => v === background[i]),
        error: renderer.getContext().getError(),
      };
    } finally {
      gpu.dispose();
    }
  });
  for (const { ratio, base, outlined } of proof.cases) {
    expect(base.left - outlined.left).toBeCloseTo(2 * ratio, 0);
    expect(outlined.right - base.right).toBeCloseTo(2 * ratio, 0);
    expect(outlined.black).toBeGreaterThanOrEqual(7 * ratio);
    expect(outlined.black).toBeLessThanOrEqual(9 * ratio);
  }
  expect(proof.hiddenEqual).toBe(true);
  expect(proof.hiddenOffEqual).toBe(true);
  expect(proof.error).toBe(0);
});

test('animated outline samples the composited pose and fades with its artwork', async ({
  page,
}) => {
  await page.route('**/animated-outline-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/animated-outline-proof.html');
  const proof = await page.evaluate(async () => {
    const gpuPath = '/tests/fixtures/gpu.ts',
      spritePath = '/src/presentation/sprite.ts',
      manifestPath = '/tests/fixtures/manifest.ts';
    const { T, gpuFixture } = await import(gpuPath),
      { ActorSprite, setCutoutOpacity } = await import(spritePath),
      { manifestFixture } = await import(manifestPath);
    const gpu = gpuFixture(128),
      { renderer, scene, camera, own } = gpu;
    renderer.setClearColor(0x808080, 0);
    const manifest = manifestFixture();
    Object.assign(manifest.asset, {
      canvas: [32, 32],
      anchor: [16, 16],
      density: 16,
      renderStyle: 'clean-ink',
    });
    const frame = manifest.frames[0];
    frame.rect = [0, 0, 32, 32];
    frame.trim = [0, 0, 32, 32];
    manifest.frames.push({ ...frame, id: 'next', rect: [32, 0, 32, 32] });
    manifest.pages[0].width = 64;
    manifest.pages[0].height = 32;
    const data = new Uint8Array(64 * 32 * 4);
    for (let y = 8; y < 24; y++)
      for (let x = 4; x < 12; x++) {
        data.fill(255, (y * 64 + x) * 4, (y * 64 + x + 1) * 4);
        data.fill(255, (y * 64 + x + 48) * 4, (y * 64 + x + 49) * 4);
      }
    const texture = own(new T.DataTexture(data, 64, 32));
    texture.needsUpdate = true;
    texture.minFilter = texture.magFilter = T.NearestFilter;
    const sprite = own(
      new ActorSprite(
        'hero',
        manifest,
        new Map([['atlas-0', texture]]),
        manifest.asset.clips.idle.d45,
      ),
    );
    scene.add(sprite.mesh);
    sprite.show(frame.id, new T.Vector3(), camera, {
      from: frame.id,
      to: 'next',
      mix: 0.5,
      motion: false,
      guarded: false,
    });
    const measure = () => {
      const pixels = gpu.capture(),
        row = 64;
      let gapPixels = 0,
        alpha = 0;
      for (let x = 0; x < 128; x++) {
        const i = (row * 128 + x) * 4;
        if (pixels[i + 3] > 10) {
          alpha += pixels[i + 3];
        }
        if (x >= 60 && x <= 67 && pixels[i + 3] > 10) gapPixels++;
      }
      return {
        gapPixels,
        alpha,
        leftCore: pixels[(row * 128 + 48) * 4],
        rightCore: pixels[(row * 128 + 80) * 4],
        leftAlpha: pixels[(row * 128 + 48) * 4 + 3],
      };
    };
    try {
      sprite.outline.enabled = false;
      const baseline = measure();
      sprite.outline.enabled = true;
      const full = measure();
      setCutoutOpacity(sprite.material, 0.25);
      const faded = measure();
      setCutoutOpacity(sprite.material, 0);
      const invisible = measure();
      return { baseline, full, faded, invisible, error: renderer.getContext().getError() };
    } finally {
      gpu.dispose();
    }
  });
  expect(proof.baseline.leftAlpha).toBeGreaterThan(100);
  expect(proof.full.leftCore).toBeCloseTo(proof.baseline.leftCore, 0);
  expect(proof.full.rightCore).toBeCloseTo(proof.baseline.rightCore, 0);
  expect(proof.full.gapPixels).toBe(0);
  expect(proof.faded.alpha).toBeLessThan(proof.full.alpha * 0.4);
  expect(proof.faded.alpha).toBeGreaterThan(proof.full.alpha * 0.1);
  expect(proof.invisible.alpha).toBe(0);
  expect(proof.error).toBe(0);
});

test('soft contours match the approved inset study without broken bands', async ({ page }) => {
  await page.route('**/soft-outline-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/soft-outline-proof.html');
  const proof = await page.evaluate(async () => {
    const gpuPath = '/tests/fixtures/gpu.ts',
      spritePath = '/src/presentation/sprite.ts',
      manifestPath = '/tests/fixtures/manifest.ts',
      studyPath = '/src/presentation/playground-materials.ts';
    const { T, gpuFixture } = await import(gpuPath),
      { ActorSprite } = await import(spritePath),
      { manifestFixture } = await import(manifestPath),
      { SilhouetteOutline } = await import(studyPath);
    const gpu = gpuFixture(128),
      { renderer, scene, camera, own } = gpu,
      manifest = manifestFixture();
    Object.assign(manifest.asset, {
      canvas: [32, 32],
      anchor: [16, 16],
      density: 16,
      renderStyle: 'clean-ink',
    });
    manifest.pages[0].width = manifest.pages[0].height = 32;
    const data = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const distance = Math.hypot(x - 15.5, y - 15.5),
          coverage = Math.max(0, Math.min(1, (12 - distance) / 2));
        data.set([220, 180, 140, Math.round(coverage * 255)], (y * 32 + x) * 4);
      }
    // A narrow hole exercises coverage between the concentric sample rings.
    for (let y = 13; y < 19; y++) data[(y * 32 + 16) * 4 + 3] = 0;
    const texture = own(new T.DataTexture(data, 32, 32));
    texture.needsUpdate = true;
    texture.minFilter = texture.magFilter = T.LinearFilter;
    const sprite = own(
      new ActorSprite(
        'hero',
        manifest,
        new Map([['atlas-0', texture]]),
        manifest.asset.clips.idle.d45,
      ),
    );
    scene.add(sprite.mesh);
    sprite.show(manifest.frames[0].id, new T.Vector3(), camera);
    renderer.setClearColor(0x888888, 1);
    const study = own(new SilhouetteOutline(sprite.mesh));
    try {
      sprite.outline.enabled = false;
      study.update(
        (4 * 4) / 128,
        { thickness: 4, opacity: 1, color: '#080808', style: 'solid' },
        2,
      );
      scene.add(study.mesh);
      const expected = gpu.capture();
      study.mesh.removeFromParent();
      sprite.outline.enabled = true;
      const actual = gpu.capture();
      let error = 0,
        changed = 0;
      for (let i = 0; i < actual.length; i += 4) {
        const difference = Math.max(
          ...[0, 1, 2].map((c) => Math.abs(actual[i + c] - expected[i + c])),
        );
        error += difference;
        if (difference > 10) changed++;
      }
      return {
        averageError: error / (128 * 128),
        changed,
        error: renderer.getContext().getError(),
      };
    } finally {
      gpu.dispose();
    }
  });
  expect(proof.averageError).toBeLessThan(2);
  expect(proof.changed).toBeLessThan(128 * 128 * 0.01);
  expect(proof.error).toBe(0);
});
