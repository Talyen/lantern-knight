import { test, expect } from './fixtures';

test('solid props cast sun and moving local-light silhouettes, receive warm light, and retire maps', async ({
  page,
}) => {
  await page.route('**/local-shadow-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
  );
  await page.goto('/local-shadow-proof.html');
  const proof = await page.evaluate(async () => {
    const threePath = '/node_modules/.vite/deps/three.js',
      lightingPath = '/src/presentation/illustrated-lighting.ts',
      localPath = '/src/presentation/local-light-shadows.ts',
      proxiesPath = '/src/presentation/shadow-proxies.ts',
      spritePath = '/src/presentation/sprite.ts',
      fixturePath = '/tests/fixtures/manifest.ts',
      cameraPath = '/src/presentation/camera.ts',
      profilesPath = '/src/presentation/lighting-profiles.ts';
    const T = await import(threePath),
      { IllustratedLighting } = await import(lightingPath),
      { LocalLightShadows } = await import(localPath),
      { ShadowProxies } = await import(proxiesPath),
      { ActorSprite } = await import(spritePath),
      { manifestFixture } = await import(fixturePath),
      { makeCamera, right, outward } = await import(cameraPath),
      { defaultLook } = await import(profilesPath);
    const renderer = new T.WebGLRenderer({
      canvas: document.querySelector('canvas')!,
      antialias: false,
    });
    renderer.setSize(192, 192);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    const scene = new T.Scene(),
      camera = makeCamera(1);
    camera.position.copy(outward).multiplyScalar(30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.left = camera.bottom = -3;
    camera.right = camera.top = 3;
    camera.updateProjectionMatrix();
    const target = new T.WebGLRenderTarget(192, 192),
      lighting = new IllustratedLighting(),
      local = new LocalLightShadows(scene, renderer, lighting),
      sun = new T.DirectionalLight(0xffffff, 0);
    sun.castShadow = true;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -5;
    sun.shadow.camera.right = sun.shadow.camera.top = 5;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 30;
    sun.shadow.mapSize.set(512, 512);
    sun.position.set(-4, 6, 3);
    scene.add(sun, sun.target);
    const fallback = new T.DepthTexture(1, 1, T.UnsignedIntType);
    fallback.compareFunction = T.LessEqualCompare;
    fallback.needsUpdate = true;
    Object.defineProperty(lighting.common.inkShadowMap, 'value', {
      get: () => sun.shadow.map?.depthTexture ?? fallback,
    });
    lighting.common.inkShadowMatrix.value = sun.shadow.matrix;
    const mask = new Uint8Array(32 * 32 * 4);
    for (let y = 2; y < 31; y++)
      for (let x = 3; x < 29; x++)
        if (y < 17 || (x >= 12 && x < 20)) mask.fill(255, (y * 32 + x) * 4, (y * 32 + x + 1) * 4);
    const texture = new T.DataTexture(mask, 32, 32);
    texture.needsUpdate = true;
    texture.magFilter = texture.minFilter = T.NearestFilter;
    const m = manifestFixture('solid-prop');
    m.asset.type = 'prop';
    m.asset.canvas = [32, 32];
    m.asset.anchor = [16, 32];
    m.asset.density = 20;
    m.pages[0]!.width = m.pages[0]!.height = 32;
    const sprite = new ActorSprite(
      'solid-prop',
      m,
      new Map([['atlas-0', texture]]),
      m.asset.clips.idle.d45,
    );
    sprite.show(m.frames[0].id, new T.Vector3(), camera);
    scene.add(sprite.mesh);
    lighting.sprite(sprite);
    const groundTexture = new T.DataTexture(new Uint8Array([190, 190, 190, 255]), 1, 1);
    groundTexture.needsUpdate = true;
    const groundMaterial = new T.MeshBasicMaterial({ map: groundTexture, toneMapped: false }),
      ground = new T.Mesh(new T.PlaneGeometry(10, 10), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.015;
    lighting.attach(groundMaterial, true);
    scene.add(ground);
    const proxies = new ShadowProxies(sun, local.lights);
    proxies.build(
      { areaDefinition: { surface: { kind: 'flat', height: 0 } } },
      {
        props: [{ id: sprite.id, asset: m.asset.id, clip: 'idle', x: 0, z: 0, shadow: 'contact' }],
      },
      [sprite],
    );
    proxies.updateScenery([sprite]);
    scene.add(proxies.proxies);
    lighting.configure({ ...defaultLook, atmosphere: false }, new T.Vector3());
    lighting.common.inkDirection.value.copy(sun.position).normalize();
    const capture = (side: number, shadows: boolean, day = false, lit = true, slot = 0) => {
      lighting.common.inkLightPosition.value[slot]
        .copy(right)
        .multiplyScalar(side * 2)
        .add(new T.Vector3(0, 1.3, 0));
      lighting.common.inkLightPower.value.fill(0);
      lighting.common.inkLightPower.value[slot] = day || !lit ? 0 : 2;
      lighting.common.inkLightRange.value[slot] = 7;
      lighting.common.inkShadowEnabled.value = day && shadows ? 1 : 0;
      local.update(!day && shadows);
      sun.castShadow = day && shadows;
      proxies.proxies.visible = shadows;
      if (day) lighting.common.inkKeyStrength.value = 1;
      else lighting.common.inkKeyStrength.value = 0;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(192 * 192 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 192, 192, pixels);
      return pixels;
    };
    const left = capture(-1, false),
      leftShadow = capture(-1, true),
      rightImage = capture(1, false),
      rightShadow = capture(1, true),
      day = capture(1, false, true),
      dayShadow = capture(1, true, true);
    const differences = (a: Uint8Array, b: Uint8Array) => {
      let count = 0,
        total = 0;
      for (let i = 0; i < a.length; i += 4) {
        const delta = a[i]! + a[i + 1]! + a[i + 2]! - b[i]! - b[i + 1]! - b[i + 2]!;
        if (delta > 8) {
          count++;
          total += delta;
        }
      }
      return { count, total };
    };
    const change = differences(left, leftShadow),
      moving = differences(rightImage, rightShadow),
      sunProof = differences(day, dayShadow);
    const perSlot = Array.from(
      { length: 5 },
      (_, slot) =>
        differences(capture(-1, false, false, true, slot), capture(-1, true, false, true, slot))
          .count,
    );
    ground.visible = false;
    const darkProp = capture(-1, false, false, false),
      litProp = capture(-1, false),
      shadowedProp = capture(-1, true);
    let illuminated = 0,
      warmRed = 0,
      warmBlue = 0,
      litTotal = 0,
      shadowedTotal = 0;
    for (let i = 0; i < litProp.length; i += 4) {
      const delta =
        litProp[i]! +
        litProp[i + 1]! +
        litProp[i + 2]! -
        darkProp[i]! -
        darkProp[i + 1]! -
        darkProp[i + 2]!;
      if (delta > 8) {
        illuminated++;
        warmRed += litProp[i]! - darkProp[i]!;
        warmBlue += litProp[i + 2]! - darkProp[i + 2]!;
      }
      litTotal += litProp[i]! + litProp[i + 1]! + litProp[i + 2]!;
      shadowedTotal += shadowedProp[i]! + shadowedProp[i + 1]! + shadowedProp[i + 2]!;
    }
    const maps = local.bytes();
    local.reset();
    const cleared = local.bytes();
    const active = local.lights.some(
      (l: { castShadow: boolean; visible: boolean }) => l.castShadow || l.visible,
    );
    const result = {
      change,
      moving,
      sunProof,
      perSlot,
      illuminated,
      warmRed,
      warmBlue,
      litTotal,
      shadowedTotal,
      maps,
      cleared,
      active,
      casters: proxies.proxies.children.length,
      error: renderer.getContext().getError(),
    };
    proxies.reset();
    local.dispose();
    lighting.dispose();
    sun.shadow.dispose();
    fallback.dispose();
    sprite.dispose();
    ground.geometry.dispose();
    groundMaterial.dispose();
    texture.dispose();
    groundTexture.dispose();
    target.dispose();
    renderer.dispose();
    return result;
  });
  expect(proof.error).toBe(0);
  expect(proof.casters).toBe(1);
  expect(proof.change.count).toBeGreaterThan(20);
  expect(proof.moving.count).toBeGreaterThan(20);
  expect(proof.sunProof.count).toBeGreaterThan(20);
  for (const count of proof.perSlot) expect(count).toBeGreaterThan(20);
  expect(proof.illuminated).toBeGreaterThan(50);
  expect(proof.warmRed).toBeGreaterThan(proof.warmBlue);
  expect(proof.shadowedTotal).toBeGreaterThan(proof.litTotal * 0.85);
  expect(proof.maps).toBeGreaterThan(0);
  expect(proof.cleared).toBe(0);
  expect(proof.active).toBe(false);
});
