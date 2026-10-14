import { test, expect } from './fixtures';

// GPU proof with small real sprites: painted shade affects overlays, while local
// illumination remains additive and the already-shaded painting stays unchanged.
test('painted shade grounds characters and props without double-shading the floor or dimming emission', async ({
  page,
}) => {
  await page.route('**/shade-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/shade-proof.html');
  const proof = await page.evaluate(async () => {
    const threePath = '/node_modules/.vite/deps/three.js',
      lightingPath = '/src/presentation/illustrated-lighting.ts',
      profilesPath = '/src/presentation/lighting-profiles.ts',
      spritesPath = '/src/presentation/sprite.ts',
      fixturePath = '/tests/fixtures/manifest.ts',
      cameraPath = '/src/presentation/camera.ts';
    const T = await import(threePath),
      { IllustratedLighting } = await import(lightingPath),
      { defaultLook } = await import(profilesPath),
      { ActorSprite } = await import(spritesPath),
      { manifestFixture } = await import(fixturePath),
      { outward, right } = await import(cameraPath);
    const renderer = new T.WebGLRenderer({ canvas: document.querySelector('canvas')! });
    renderer.setSize(160, 96);
    const target = new T.WebGLRenderTarget(160, 96),
      scene = new T.Scene(),
      camera = new T.OrthographicCamera(-2.5, 2.5, 1.5, -1.5, 0.1, 100),
      lighting = new IllustratedLighting(),
      texture = new T.DataTexture(new Uint8Array([190, 170, 140, 255]), 1, 1);
    const shadowFallback = new T.DepthTexture(1, 1, T.UnsignedIntType);
    shadowFallback.compareFunction = T.LessEqualCompare;
    shadowFallback.needsUpdate = true;
    lighting.common.inkShadowMap.value = shadowFallback;
    texture.needsUpdate = true;
    camera.position.copy(outward).multiplyScalar(30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const sprites = Array.from({ length: 3 }, (_, i) => {
      const m = manifestFixture('shade-' + i);
      m.asset.canvas = [32, 32];
      m.asset.anchor = [16, 32];
      m.asset.density = 32;
      m.asset.type = i === 1 ? 'prop' : i === 2 ? 'effect' : 'character';
      const sprite = new ActorSprite(
        'shade-' + i,
        m,
        new Map([['atlas-0', texture]]),
        m.asset.clips.idle!.d45!,
      );
      sprite.mesh.userData.emissive = i === 2;
      sprite.show(m.frames[0]!.id, right.clone().multiplyScalar((i - 1) * 1.5), camera);
      lighting.sprite(sprite);
      scene.add(sprite.mesh);
      return sprite;
    });
    const floorMaterial = new T.MeshBasicMaterial({ map: texture, toneMapped: false }),
      floor = new T.Mesh(new T.PlaneGeometry(6, 6), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    lighting.attach(floorMaterial, true);
    scene.add(floor);
    const settings = {
      ...defaultLook,
      atmosphere: false,
      shadeZones: [{ x: 0, z: 0, radius: 5, strength: 0.65 }],
    };
    const capture = (shade: boolean, local: boolean) => {
      lighting.configure(
        { ...settings, shadeZones: shade ? settings.shadeZones : undefined },
        new T.Vector3(),
      );
      lighting.common.inkShadowEnabled.value = 0;
      lighting.common.inkLightPower.value[0] = local ? 1.5 : 0;
      lighting.common.inkLightPosition.value[0]!.set(0, 1, 0);
      lighting.common.inkLightRange.value[0] = 5;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(160 * 96 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 160, 96, pixels);
      return pixels;
    };
    const base = capture(false, false),
      shade = capture(true, false),
      lit = capture(true, true),
      reset = capture(false, false);
    const darkened = [0, 0, 0],
      brightened = [0, 0, 0];
    let floorChanges = 0,
      resetChanges = 0;
    for (let i = 0; i < base.length; i += 4) {
      const x = (i / 4) % 160,
        y = Math.floor(i / 4 / 160),
        slot = x < 56 ? 0 : x < 104 ? 1 : 2,
        value = (p: Uint8Array) => p[i]! + p[i + 1]! + p[i + 2]!;
      if (value(base) - value(shade) > 3) darkened[slot]!++;
      if (value(lit) - value(shade) > 3) brightened[slot]!++;
      if (y < 20 && value(base) !== value(shade)) floorChanges++;
      if (value(reset) !== value(base)) resetChanges++;
    }
    const result = {
      darkened,
      brightened,
      floorChanges,
      resetChanges,
      error: renderer.getContext().getError(),
    };
    sprites.forEach((s) => s.dispose());
    floor.geometry.dispose();
    floorMaterial.dispose();
    texture.dispose();
    lighting.dispose();
    shadowFallback.dispose();
    target.dispose();
    renderer.dispose();
    return result;
  });
  expect(proof.error).toBe(0);
  expect(proof.darkened[0]).toBeGreaterThan(100);
  expect(proof.darkened[1]).toBeGreaterThan(100);
  expect(proof.darkened[2]).toBe(0);
  expect(proof.brightened[0]).toBeGreaterThan(100);
  expect(proof.brightened[1]).toBeGreaterThan(100);
  expect(proof.floorChanges).toBe(0);
  expect(proof.resetChanges).toBe(0);
});

test('editor shade zones can be authored, previewed and undone without saving a scene', async ({
  page,
}) => {
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  await page.locator('#scene-tab').click();
  await page.locator('[data-section="category-Atmosphere"] > summary').click();
  await page.locator('[data-section="look.shadeZones"] > summary').click();
  await page.getByRole('button', { name: 'Add Painted shade zones', exact: true }).click();
  await page.waitForFunction(
    () => window.sceneEditor.state().document.look.shadeZones?.length === 1,
  );
  await page.locator('[data-section="look.shadeZones.0"] > summary').click();
  const x = page.locator('[data-field="look.shadeZones.0.x"]');
  await x.fill('2');
  await x.blur();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.look.shadeZones?.[0]?.x))
    .toBe(2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.sceneEditor.view().presentation!.lookRenderer.lighting.common.inkShadeZones
            .value[0]!.x,
      ),
    )
    .toBe(2);
  await page.locator('#undo').click();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.look.shadeZones?.[0]?.x))
    .toBe(0);
  await page.locator('#undo').click();
  await expect
    .poll(() =>
      page.evaluate(() => window.sceneEditor.state().document.look.shadeZones?.length ?? 0),
    )
    .toBe(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.sceneEditor.view().presentation!.lookRenderer.lighting.common.inkShadeZones
            .value[0]!.w,
      ),
    )
    .toBe(0);
  await page.locator('#redo').click();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.look.shadeZones?.length))
    .toBe(1);
});
