import assert from 'node:assert/strict';
import path from 'node:path';
import type { Page, ElectronApplication } from 'playwright';
import { isSupportedPosition, type AreaDefinition, type Point } from '../src/content/world';
import type { WorldVisualDefinition } from '../src/content/world-art';
import type { AssetCache } from './assets/cache';
import type { LookSettings } from '../src/presentation/lighting-profiles';
import type {} from '../src/inspection';

export type SceneContext = {
  page: Page;
  browser: ElectronApplication;
  scene: string;
  area: AreaDefinition;
  art: WorldVisualDefinition | undefined;
  route: Point[];
  foreground: Point;
  held: Awaited<ReturnType<AssetCache['lease']>>;
  initialLook: LookSettings;
  capture: boolean;
  benchmark: boolean;
};

export async function traverseScene(context: SceneContext) {
  const { page, area, route } = context;
  for (const point of route)
    assert.ok(
      isSupportedPosition(area, point, 0.3),
      `Blocked traversal waypoint ${point.x}/${point.z}`,
    );
  await page.evaluate(
    (points) => {
      const f = window.foundation;
      f.mode('encounter');
      f.pause(true);
      f.sim.enemies.forEach((actor) => (actor.health = 0));
      const h = f.sim.hero;
      Object.assign(h, points[0], { px: points[0]!.x, pz: points[0]!.z });
      f.sim.move(h, 0, 0);
      for (const target of points.slice(1)) {
        let reached = false;
        for (let i = 0; i < 1500; i++) {
          const dx = target.x - h.x,
            dz = target.z - h.z,
            d = Math.hypot(dx, dz);
          if (d < 0.12) {
            reached = true;
            break;
          }
          f.sim.step({ move: { x: dx / d, z: dz / d }, aim: target });
          if (i % 30 === 0) f.presentation.update(f.sim, 1, 1000 / 60, target);
        }
        if (!reached) throw new Error(`Traversal blocked before ${target.x}/${target.z}`);
      }
      f.presentation.update(f.sim, 1, 0, { x: h.x + 1, z: h.z });
      f.presentation.artConstruction.update(
        f.sim.areaDefinition,
        f.presentation.inkRoom,
        f.sim.generation,
        true,
      );
      if (f.presentation.artConstruction.findings.length)
        throw new Error(JSON.stringify(f.presentation.artConstruction.findings));
    },
    route.map(({ x, z }) => ({ x, z })),
  );
}

export async function checkForeground(context: SceneContext) {
  const { page, art, foreground } = context;
  if (!art) return;
  await page.evaluate((position) => {
    const f = window.foundation;
    Object.assign(f.sim.hero, position, { px: position.x, pz: position.z });
    f.sim.move(f.sim.hero, 0, 0);
    for (let i = 0; i < 30; i++)
      f.presentation.update(f.sim, 1, 1000 / 60, {
        x: position.x + 1,
        z: position.z,
      });
    const room = f.presentation.inkRoom!;
    const materials = room.sprites.map((s) => [
      s.material.version,
      s.material.transparent,
      s.material.depthWrite,
    ]);
    for (const delta of [0.04, 0, 0.04, 0]) {
      f.sim.hero.z = position.z + delta;
      f.sim.hero.pz = f.sim.hero.z;
      f.presentation.update(f.sim, 1, 1000 / 60, {
        x: position.x + 1,
        z: f.sim.hero.z,
      });
    }
    const current = room.sprites.map((s) => [
      s.material.version,
      s.material.transparent,
      s.material.depthWrite,
    ]);
    if (JSON.stringify(materials) !== JSON.stringify(current))
      throw new Error('Small foreground reversals changed shader/depth policy');
    if (f.presentation.renderer.getContext().getError() !== 0) throw new Error('WebGL error');
  }, foreground);
}

export async function benchmarkSurround(context: SceneContext) {
  const { page } = context;
  return await page.evaluate(async () => {
    const f = window.foundation,
      p = f.presentation,
      results = [];
    f.pause(true);
    try {
      for (const enabled of [false, true]) {
        p.surround.scene.visible = enabled;
        for (let i = 0; i < 6; i++) {
          p.update(f.sim, 1, 0, { x: 0, z: 0 });
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        let cpu = 0,
          calls = 0,
          triangles = 0,
          gpu = 0,
          gpuSamples = 0;
        for (let i = 0; i < 24; i++) {
          const start = performance.now();
          p.update(f.sim, 1, 0, { x: 0, z: 0 });
          cpu += performance.now() - start;
          const cost = p.lookRenderer.stats().frameCost;
          calls += cost.calls;
          triangles += cost.triangles;
          if (cost.gpuMs !== null) {
            gpu += cost.gpuMs;
            gpuSamples++;
          }
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        results.push({
          enabled,
          cpuMs: cpu / 24,
          gpuMs: gpuSamples ? gpu / gpuSamples : null,
          calls: calls / 24,
          triangles: triangles / 24,
          buffer: p.stats().buffer,
          span: p.viewSpan,
        });
      }
    } finally {
      p.surround.scene.visible = true;
    }
    return results;
  });
}

export async function checkSurround(context: SceneContext) {
  const { page, browser, art } = context;
  if (art?.surround) {
    for (const [width, height] of [
      [1440, 1080],
      [1920, 1080],
      [2520, 1080],
    ]) {
      await browser.evaluate(
        ({ BrowserWindow }, { width, height }) =>
          BrowserWindow.getAllWindows()[0]!.setContentSize(width, height + 128),
        { width: width!, height: height! },
      );
      await page.waitForFunction(
        (width) => window.foundation.presentation.canvas.clientWidth === width,
        width,
      );
      await page.evaluate(() => window.foundation.presentation.resize());
      for (const span of [9, 11, 13, 15])
        await page.evaluate((span) => {
          const f = window.foundation,
            p = f.presentation;
          p.verticalSpan = span;
          p.resize();
          p.update(f.sim, 1, 0, { x: 0, z: 0 });
          if (p.surround.stats().tiles === 0) throw new Error('Missing scene surround');
          if (p.renderer.getContext().getError() !== 0)
            throw new Error('Surround resize produced a WebGL error');
        }, span);
    }
    // Real framebuffer evidence: scenery changes exterior pixels while the room
    // remains opaque. This also exercises the direct (no postprocessing) path.
    await page.evaluate(() => {
      const f = window.foundation,
        p = f.presentation,
        settings = { ...p.lookRenderer.settings };
      p.lookRenderer.setSettings({ postprocessing: false });
      p.setDepthOfField(0);
      const copy = document.createElement('canvas');
      copy.width = p.canvas.width;
      copy.height = p.canvas.height;
      const ctx = copy.getContext('2d')!;
      p.update(f.sim, 1, 0, { x: 0, z: 0 });
      ctx.drawImage(p.canvas, 0, 0);
      const before = ctx.getImageData(0, 0, copy.width, copy.height).data,
        children = [...p.surround.scene.children];
      for (const c of children) c.visible = false;
      // renderFrame updates the surround; render its current scenes directly to
      // hold camera, shader time, actor poses and hidden background cards fixed.
      p.surround.render(p.renderer, p.camera, p.scene);
      ctx.drawImage(p.canvas, 0, 0);
      const after = ctx.getImageData(0, 0, copy.width, copy.height).data;
      let changed = 0;
      for (let i = 0; i < before.length; i += 4)
        if (
          before[i] !== after[i] ||
          before[i + 1] !== after[i + 1] ||
          before[i + 2] !== after[i + 2]
        )
          changed++;
      if (changed < 1000) throw new Error('Painted surround did not reach the framebuffer');
      const point = p.cameraTarget
          .clone()
          .set(
            0,
            f.sim.areaDefinition.surface.kind === 'flat' ? f.sim.areaDefinition.surface.height! : 0,
            3,
          )
          .project(p.camera),
        x = Math.round(((point.x + 1) * copy.width) / 2),
        y = Math.round(((1 - point.y) * copy.height) / 2);
      if (x >= 0 && x < copy.width && y >= 0 && y < copy.height) {
        const i = (y * copy.width + x) * 4;
        for (let c = 0; c < 3; c++)
          if (before[i + c] !== after[i + c])
            throw new Error('Backdrop painted over the room ground');
      }
      p.lookRenderer.setSettings(settings);
      p.setDepthOfField(settings.depthOfField);
      p.verticalSpan = 9;
      p.resize();
      p.update(f.sim, 1, 0, { x: 0, z: 0 });
    });
    await browser.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(2560, 1600),
    );
    await page.waitForFunction(() => window.foundation.presentation.canvas.clientWidth === 2560);
    await page.evaluate(() => window.foundation.presentation.resize());
  }
}

export async function checkRoomLifetime(context: SceneContext) {
  const { page, scene } = context;
  const resources = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(async (scene) => {
      const f = window.foundation;
      await f.fixture(scene);
      f.pause(true);
      f.presentation.update(f.sim, 1, 0, { x: 0, z: 0 });
    }, scene);
    resources.push(await page.evaluate(() => window.foundation.stats().objects));
  }
  assert.deepEqual(resources[3], resources[2], 'Room replacement leaked GPU resources');
}

export async function checkPreviewReload(context: SceneContext) {
  const { page, scene } = context;
  // Exercise real reload persistence, rather than certifying the parser alone.
  const other = scene === 'court' ? 'upper-landing' : 'court';
  await page.evaluate(async (other) => {
    await window.foundation.fixture(other);
  }, other);
  await page.evaluate(() => {
    const f = window.foundation;
    f.mode('lighting');
    f.pause(true);
    f.presentation.verticalSpan = 11;
    f.presentation.resize();
    f.presentation.lightingLab.setSettings({ rig: 'silver', strength: 0.8 });
  });
  const saved = await page.evaluate(() => ({
    x: window.foundation.sim.hero.x,
    z: window.foundation.sim.hero.z,
  }));
  const reloadStart = performance.now();
  await page.reload();
  await page.waitForFunction(
    () => window.foundation?.ready && window.foundation.presentation.lookRenderer.ready,
    {},
    { timeout: 45000 },
  );
  const reloadMs = Math.round(performance.now() - reloadStart);
  assert.deepEqual(
    await page.evaluate(() => ({
      x: window.foundation.sim.hero.x,
      z: window.foundation.sim.hero.z,
    })),
    saved,
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      scene: window.foundation.sim.area,
      span: window.foundation.presentation.verticalSpan,
      rig: window.foundation.presentation.lightingLab.settings.rig,
      strength: window.foundation.presentation.lightingLab.settings.strength,
      paused: !document.querySelector<HTMLElement>('#modal')!.hidden,
    })),
    { scene: other, span: 11, rig: 'silver', strength: 0.8, paused: true },
  );
  // Modes that reset the look on entry must still restore the saved preview
  // settings after reload, including the controls that display those settings.
  const savedLook = await page.evaluate(() => {
    const f = window.foundation;
    f.mode('occlusion');
    f.presentation.lightingLab.setSettings({
      rig: 'silver',
      look: 'ink',
      strength: 0.8,
      postprocessing: false,
    });
    f.pause(true);
    return { ...f.presentation.lightingLab.settings };
  });
  await page.reload();
  await page.waitForFunction(
    () => window.foundation?.ready && window.foundation.presentation.lookRenderer.ready,
    {},
    { timeout: 45000 },
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      ...window.foundation.presentation.lightingLab.settings,
    })),
    savedLook,
    'Reload reset saved preview lighting',
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      rig: document.querySelector<HTMLSelectElement>('#lighting-rig')!.value,
      look: document.querySelector<HTMLSelectElement>('#lighting-look')!.value,
      strength: document.querySelector<HTMLInputElement>('#lighting-strength')!.value,
      post: document.querySelector<HTMLInputElement>('#lighting-post')!.checked,
    })),
    { rig: 'silver', look: 'ink', strength: '80', post: false },
  );
  assert.deepEqual(
    await page.evaluate(() => [
      localStorage.getItem('lantern-game'),
      localStorage.getItem('lantern-dev-sandbox-game'),
      localStorage.getItem('lantern-scene-preview-v1'),
    ]),
    [null, null, null],
  );
  return reloadMs;
}

export async function captureScene(context: SceneContext) {
  const { page, scene, area, art, route, foreground, held, initialLook } = context;
  if (context.capture) {
    await page.evaluate(
      async ({ scene, look }) => {
        const f = window.foundation;
        await f.fixture(scene);
        f.presentation.lightingLab.setSettings(look);
        f.presentation.setDepthOfField(look.depthOfField);
        f.presentation.verticalSpan = 9;
        f.presentation.resize();
      },
      { scene, look: initialLook },
    );
    const poses = [area.entries[0]!, route[Math.floor(route.length / 2)]!, foreground];
    for (const [i, pose] of poses.entries()) {
      await page.evaluate(
        ({ pose, span }) => {
          const f = window.foundation;
          f.mode('encounter');
          f.pause(true);
          f.presentation.verticalSpan = span;
          f.presentation.resize();
          Object.assign(f.sim.hero, pose, { px: pose.x, pz: pose.z });
          f.sim.move(f.sim.hero, 0, 0);
          for (const selector of ['#modal', '.title-card', '.hud', '.actions'])
            document.querySelector<HTMLElement>(selector)!.hidden = true;
          for (let i = 0; i < 24; i++)
            f.presentation.update(f.sim, 1, 1000 / 60, {
              x: pose.x + 1,
              z: pose.z,
            });
        },
        {
          pose: { x: pose.x, z: pose.z },
          span: i === 1 && art?.surround ? 13 : 9,
        },
      );
      await page.locator('canvas').screenshot({
        path: path.join(held.root, ['arrival.png', 'composition.png', 'foreground.png'][i]!),
      });
    }
  }
}
