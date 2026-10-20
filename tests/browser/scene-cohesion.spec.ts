import { expectPageValue, pixelTest as test, stateTest as state, expect } from './fixtures';
import { expectEditorDocument } from './editor-driver';

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
    const gpuPath = '/tests/fixtures/gpu.ts',
      lightingPath = '/src/presentation/illustrated-lighting.ts',
      profilesPath = '/src/presentation/lighting-profiles.ts',
      spritesPath = '/src/presentation/sprite.ts',
      fixturePath = '/tests/fixtures/manifest.ts',
      cameraPath = '/src/presentation/camera.ts';
    const { T, gpuFixture } = await import(gpuPath),
      { IllustratedLighting } = await import(lightingPath),
      { defaultLook } = await import(profilesPath),
      { ActorSprite } = await import(spritesPath),
      { manifestFixture } = await import(fixturePath),
      { right } = await import(cameraPath);
    const gpu = gpuFixture(160, 96, 3),
      { renderer, scene, camera, own } = gpu;
    const lighting = own(new IllustratedLighting()),
      texture = own(new T.DataTexture(new Uint8Array([190, 170, 140, 255]), 1, 1));
    const shadowFallback = own(new T.DepthTexture(1, 1, T.UnsignedIntType));
    shadowFallback.compareFunction = T.LessEqualCompare;
    shadowFallback.needsUpdate = true;
    lighting.common.inkShadowMap.value = shadowFallback;
    texture.needsUpdate = true;
    for (let i = 0; i < 3; i++) {
      const m = manifestFixture('shade-' + i);
      m.asset.canvas = [32, 32];
      m.asset.anchor = [16, 32];
      m.asset.density = 32;
      m.asset.type = i === 1 ? 'prop' : i === 2 ? 'effect' : 'character';
      const sprite = own(
        new ActorSprite('shade-' + i, m, new Map([['atlas-0', texture]]), m.asset.clips.idle!.d45!),
      );
      sprite.mesh.userData.emissive = i === 2;
      sprite.show(m.frames[0]!.id, right.clone().multiplyScalar((i - 1) * 1.5), camera);
      lighting.sprite(sprite);
      scene.add(sprite.mesh);
    }
    const floorMaterial = own(new T.MeshBasicMaterial({ map: texture, toneMapped: false })),
      floor = new T.Mesh(own(new T.PlaneGeometry(6, 6)), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    lighting.attach(floorMaterial, true);
    scene.add(floor);
    const settings = {
      ...defaultLook,
      rig: 'silver' as const,
      atmosphere: false,
      shadeZones: [{ x: 0, z: 0, radius: 5, strength: 0.65 }],
    };
    const capture = (shade: boolean, local: boolean, rig: 'silver' | 'lantern' = 'silver') => {
      lighting.configure(
        { ...settings, rig, shadeZones: shade ? settings.shadeZones : undefined },
        new T.Vector3(),
      );
      lighting.common.inkShadowEnabled.value = 0;
      lighting.common.inkLightPower.value[0] = local ? 1.5 : 0;
      lighting.common.inkLightPosition.value[0]!.set(0, 1, 0);
      lighting.common.inkLightRange.value[0] = 5;
      return gpu.capture();
    };
    const base = capture(false, false),
      shade = capture(true, false),
      lit = capture(true, true),
      reset = capture(false, false),
      night = capture(false, false, 'lantern'),
      lantern = capture(false, true, 'lantern');
    const darkened = [0, 0, 0],
      brightened = [0, 0, 0],
      nightDarkened = [0, 0, 0],
      lanternLit = [0, 0, 0];
    let floorChanges = 0,
      resetChanges = 0,
      lanternFloor = 0,
      warmRed = 0,
      warmBlue = 0;
    for (let i = 0; i < base.length; i += 4) {
      const x = (i / 4) % 160,
        y = Math.floor(i / 4 / 160),
        slot = x < 56 ? 0 : x < 104 ? 1 : 2,
        value = (p: Uint8Array) => p[i]! + p[i + 1]! + p[i + 2]!;
      if (value(base) - value(shade) > 3) darkened[slot]!++;
      if (value(lit) - value(shade) > 3) brightened[slot]!++;
      const spritePixel = y >= 52 && y < 72 && Math.abs(x - (32 + slot * 48)) < 8;
      if (spritePixel && value(base) - value(night) > 3) nightDarkened[slot]!++;
      if (spritePixel && value(lantern) - value(night) > 3) lanternLit[slot]!++;
      if (y < 20 && value(lantern) - value(night) > 3) {
        lanternFloor++;
        warmRed += lantern[i]! - night[i]!;
        warmBlue += lantern[i + 2]! - night[i + 2]!;
      }
      if (y < 20 && value(base) !== value(shade)) floorChanges++;
      if (value(reset) !== value(base)) resetChanges++;
    }
    const result = {
      darkened,
      brightened,
      floorChanges,
      resetChanges,
      nightDarkened,
      lanternLit,
      lanternFloor,
      warmRed,
      warmBlue,
      error: renderer.getContext().getError(),
    };

    gpu.dispose();
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
  expect(proof.nightDarkened[0]).toBeGreaterThan(100);
  expect(proof.nightDarkened[1]).toBeGreaterThan(100);
  expect(proof.nightDarkened[2]).toBe(0);
  expect(proof.lanternLit[0]).toBeGreaterThan(100);
  expect(proof.lanternLit[1]).toBeGreaterThan(100);
  expect(proof.lanternLit[2]).toBe(0);
  expect(proof.lanternFloor).toBeGreaterThan(100);
  expect(proof.warmRed).toBeGreaterThan(proof.warmBlue);
});

state(
  'editor shade zones can be authored, previewed and undone without saving a scene',
  async ({ page }) => {
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
    await expectEditorDocument(page, (document) => document.look.shadeZones?.[0]?.x).toBe(2);
    await expectPageValue(
      page,
      () =>
        window.sceneEditor.view().presentation!.lookRenderer.lighting.common.inkShadeZones.value[0]!
          .x,
    ).toBe(2);
    await page.locator('#undo').click();
    await expectEditorDocument(page, (document) => document.look.shadeZones?.[0]?.x).toBe(0);
    await page.locator('#undo').click();
    await expectEditorDocument(page, (document) => document.look.shadeZones?.length ?? 0).toBe(0);
    await expectPageValue(
      page,
      () =>
        window.sceneEditor.view().presentation!.lookRenderer.lighting.common.inkShadeZones.value[0]!
          .w,
    ).toBe(0);
    await page.locator('#redo').click();
    await expectEditorDocument(page, (document) => document.look.shadeZones?.length).toBe(1);
  },
);

test('painting bounce excludes scenery and dense cores reuse the original shadow draw', async ({
  page,
}) => {
  await page.route('**/cohesion-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/cohesion-proof.html');
  const proof = await page.evaluate(async () => {
    const gpuPath = '/tests/fixtures/gpu.ts',
      environmentPath = '/src/presentation/painted-environment.ts',
      contactsPath = '/src/presentation/contact-shadows.ts',
      spritePath = '/src/presentation/sprite.ts',
      manifestPath = '/tests/fixtures/manifest.ts',
      lightingPath = '/src/presentation/illustrated-lighting.ts',
      profilesPath = '/src/presentation/lighting-profiles.ts';
    const { T, gpuFixture } = await import(gpuPath),
      { PaintedEnvironment } = await import(environmentPath),
      { contactShadowMaterial, setContactCore } = await import(contactsPath),
      { ActorSprite } = await import(spritePath),
      { manifestFixture } = await import(manifestPath),
      { IllustratedLighting } = await import(lightingPath),
      { defaultLook } = await import(profilesPath);
    const gpu = gpuFixture(128, 128, 3),
      { own, renderer, scene, camera } = gpu;
    const source = new Uint8Array(16 * 4 * 4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 16; x++)
        source.set(
          x < 8 ? [0, 0, 255, 255] : x < 12 ? [30, 150, 40, 255] : [180, 40, 30, 255],
          (y * 16 + x) * 4,
        );
    const floorTexture = own(new T.DataTexture(source, 16, 4));
    floorTexture.needsUpdate = true;
    const manifest = manifestFixture('floor');
    manifest.frames[0].rect = [8, 0, 8, 4];
    manifest.pages[0].width = 16;
    manifest.pages[0].height = 4;
    const packs = new Map([
        ['floor', { manifest, textures: new Map([['atlas-0', floorTexture]]) }],
      ]),
      visuals = {
        editorFloor: { asset: 'floor', clip: 'idle', width: 20, depth: 10, layout: 'artwork' },
      },
      environment = own(new PaintedEnvironment());
    renderer.setViewport(2, 3, 100, 90);
    environment.build(renderer, packs, visuals, undefined);
    const viewport = renderer.getViewport(new T.Vector4()).toArray();
    const pixels = new Uint8Array(environment.target.width * environment.target.height * 4);
    const read = () =>
      renderer.readRenderTargetPixels(
        environment.target,
        0,
        0,
        environment.target.width,
        environment.target.height,
        pixels,
      );
    read();
    const left = [...pixels.slice((32 * 128 + 20) * 4, (32 * 128 + 20) * 4 + 4)],
      right = [...pixels.slice((32 * 128 + 108) * 4, (32 * 128 + 108) * 4 + 4)];
    const cameraPath = '/src/presentation/camera.ts',
      axes = await import(cameraPath),
      position = axes.right
        .clone()
        .multiplyScalar((20.5 / 128 - 0.5) * 20)
        .addScaledVector(axes.up, (32.5 / 64 - 0.5) * 10),
      cached = environment.sample(position, new T.Vector4()).toArray(),
      midpoint = environment.sample(new T.Vector3(), new T.Vector4()).toArray(),
      expectedMidpoint = [0, 1, 2, 3].map(
        (channel) =>
          [31 * 128 + 63, 31 * 128 + 64, 32 * 128 + 63, 32 * 128 + 64].reduce(
            (sum, pixel) => sum + pixels[pixel * 4 + channel]!,
            0,
          ) /
          (4 * 255),
      ),
      outside = environment.sample(new T.Vector3(100, 0, 100), new T.Vector4()).toArray();
    const mask = new Uint8Array(8 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) mask[(y * 8 + x) * 4 + 2] = 255;
    const maskTexture = own(new T.DataTexture(mask, 8, 4));
    maskTexture.needsUpdate = true;
    environment.build(renderer, packs, visuals, { texture: maskTexture });
    read();
    const masked = pixels[(32 * 128 + 108) * 4 + 3];
    environment.build(renderer, packs, undefined, undefined);
    const reset = !environment.available && environment.stats().sampleBytes === 0,
      neutral = environment.sample(new T.Vector3(), new T.Vector4()).toArray();
    renderer.setViewport(0, 0, 128, 128);
    const drawing = new Uint8Array(32 * 32 * 4);
    // Runtime images have already been flipped on decode; DataTexture rows use that orientation.
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 32; x++)
        if ((x >= 8 && x < 12) || (x >= 20 && x < 24))
          drawing.fill(255, (y * 32 + x) * 4, (y * 32 + x + 1) * 4);
    const texture = own(new T.DataTexture(drawing, 32, 32));
    texture.needsUpdate = true;
    const m = manifestFixture('actor');
    m.asset.canvas = [32, 32];
    m.asset.anchor = [16, 32];
    m.asset.density = 24;
    m.frames[0].rect = m.frames[0].trim = [0, 0, 32, 32];
    m.pages[0].width = m.pages[0].height = 32;
    const sprite = own(
      new ActorSprite('actor', m, new Map([['atlas-0', texture]]), m.asset.clips.idle.d45),
    );
    sprite.show(m.frames[0].id, new T.Vector3(), camera);
    const shadow = own(new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1));
    shadow.needsUpdate = true;
    const material = own(contactShadowMaterial(shadow, 0.6)),
      contact = new T.Mesh(own(new T.PlaneGeometry(1.2, 0.4)), material),
      ground = new T.Mesh(
        own(new T.PlaneGeometry(10, 10)),
        own(new T.MeshBasicMaterial({ color: 0x888888 })),
      );
    ground.rotation.x = contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.04;
    ground.renderOrder = -2;
    contact.renderOrder = -1.5;
    scene.add(ground, contact);
    contact.visible = false;
    const flat = gpu.capture();
    contact.visible = true;
    const planted = gpu.capture(),
      beforeCalls = renderer.info.render.calls;
    setContactCore(material, true);
    const denser = gpu.capture(),
      afterCalls = renderer.info.render.calls;
    const differences = (a: Uint8Array, b: Uint8Array) => {
      let count = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i]! - b[i]! > 3) count++;
      return count;
    };
    material.opacity = 0;
    const hidden = gpu.capture();
    material.opacity = 0.6;
    setContactCore(material, false);
    const restored = gpu.capture();
    contact.visible = false;
    // Compile the actual shared lighting shader with both treatments enabled.
    const lighting = own(new IllustratedLighting());
    const shadowFallback = own(new T.DepthTexture(1, 1, T.UnsignedIntType));
    shadowFallback.compareFunction = T.LessEqualCompare;
    shadowFallback.needsUpdate = true;
    lighting.common.inkShadowMap.value = shadowFallback;
    lighting.configure(
      { ...defaultLook, paintedValues: true, groundBounce: true },
      new T.Vector3(),
    );
    lighting.setGroundOcclusion(undefined, { width: 20, depth: 10 });
    lighting.setEnvironment(true);
    sprite.material.opacity = 1;
    lighting.sprite(sprite, new T.Vector4(0.4, 0.7, 0.4, 1));
    scene.add(sprite.mesh);
    gpu.capture();
    const result = {
      left,
      right,
      cached,
      midpoint,
      expectedMidpoint,
      outside,
      neutral,
      masked,
      reset,
      viewport,
      planted: differences(flat, planted),
      denser: differences(planted, denser),
      hidden: differences(flat, hidden),
      restored: differences(planted, restored) + differences(restored, planted),
      beforeCalls,
      afterCalls,
      error: renderer.getContext().getError(),
    };
    gpu.dispose();
    return result;
  });
  expect(proof.left[1]!).toBeGreaterThan(proof.left[0]!);
  expect(proof.right[0]!).toBeGreaterThan(proof.right[1]!);
  expect(proof.left[3]).toBe(255);
  for (let channel = 0; channel < 4; channel++) {
    expect(proof.cached[channel]).toBeCloseTo(proof.left[channel]! / 255, 5);
    expect(proof.midpoint[channel]).toBeCloseTo(proof.expectedMidpoint[channel]!, 5);
  }
  expect(proof.outside).toEqual([0.5, 0.5, 0.5, 0]);
  expect(proof.neutral).toEqual(proof.outside);
  expect(proof.masked).toBe(0);
  expect(proof.reset).toBe(true);
  expect(proof.viewport).toEqual([2, 3, 100, 90]);
  expect(proof.planted).toBeGreaterThan(10);
  expect(proof.denser).toBeGreaterThan(10);
  expect(proof.afterCalls).toBe(proof.beforeCalls);
  expect(proof.hidden).toBe(0);
  expect(proof.restored).toBe(0);
  expect(proof.error).toBe(0);
});

state.describe('cohesion persistence', () => {
  state('orchard cohesion controls survive reload independently', async ({ page }) => {
    // Reload and fixture replacements each prepare the complete scene renderer.
    test.setTimeout(420_000);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/sandbox.html?scene=orchard-fixture');
    await page.waitForFunction(() => window.foundation?.ready);
    await page.getByRole('button', { name: 'Visuals', exact: true }).click();
    await page.getByText('Scene cohesion', { exact: true }).click();
    await page.locator('#cohesion-values').uncheck();
    await page.locator('#cohesion-finish').uncheck();
    await page.locator('#cohesion-bounce').check();
    await page.locator('#cohesion-contacts').check();
    await page.reload();
    await page.waitForFunction(() => window.foundation?.ready);
    await expect(page.locator('#cohesion-bounce')).toBeChecked();
    await expect(page.locator('#cohesion-contacts')).toBeChecked();
    await expect(page.locator('#cohesion-values')).not.toBeChecked();
    await expect(page.locator('#cohesion-finish')).not.toBeChecked();
    expect(await page.evaluate(() => window.foundation.sim.area)).toBe('orchard-fixture');
    const field = await page.evaluate(async () => {
      const f = window.foundation,
        p = f.presentation;
      p.lookRenderer.setSettings({ groundBounce: false });
      await f.fixture('orchard-fixture');
      f.pause(true);
      p.update(f.sim, 1, 0, { x: 0, z: 0 });
      const disabled = p.lookRenderer.stats().environment;
      p.lookRenderer.setSettings({ groundBounce: true });
      p.update(f.sim, 1, 0, { x: 0, z: 0 });
      const enabled = p.lookRenderer.stats().environment;
      await f.fixture('outdoor-fixture');
      p.update(f.sim, 1, 0, { x: 0, z: 0 });
      return { disabled, enabled, replaced: p.lookRenderer.stats().environment };
    });
    expect(field.disabled).toEqual({ configured: false, available: false, sampleBytes: 0 });
    expect(field.enabled.configured).toBe(true);
    expect(field.enabled.available).toBe(true);
    expect(field.enabled.sampleBytes).toBeGreaterThan(0);
    expect(field.enabled.sampleBytes).toBeLessThanOrEqual(128 * 128 * 4);
    expect(field.replaced).toEqual({ configured: true, available: false, sampleBytes: 0 });
  });
});
