import { smokeLaunch } from './smoke-launch';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { comparePixels } from './smoke-pixels';
import '../src/inspection';

const run = await smokeLaunch(true),
  { page, app, output, errors } = run,
  checks: string[] = [],
  motionCapture = run.capture && !process.argv.includes('--stills');
const positions = [
  ['arrival', 0, 7.5],
  ['nave', 0, 1],
  ['sanctuary', 0, -5.3],
  ['west-devotion', -3.6, -4.5],
  ['east-tomb', 3.4, -4.5],
  ['damage', 3.5, 0.5],
  ['return', 0, 8.2],
  ['near-east', 4.1, 3.9],
  ['nw', -5.1, -8.1],
  ['ne', 5.1, -8.1],
  ['sw', -5.1, 8.2],
  ['se', 5.1, 8.2],
] as const;
try {
  await page.waitForFunction(() => window.foundation?.ready, {}, { timeout: 60000 });
  await page.evaluate(() => window.foundation.fixture('upper-landing'));
  await page.evaluate(() => {
    window.foundation.pause(true);
    document.querySelector<HTMLElement>('#modal')!.style.display = 'none';
    for (const selector of ['.title-card', '.hud', '.actions'])
      document.querySelector<HTMLElement>(selector)!.style.display = 'none';
  });
  const resize = async (w: number, h: number) => {
    await app.evaluate(
      ({ BrowserWindow }, { w, h }) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, h + 128),
      { w, h },
    );
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
  };
  const pose = async (x: number, z: number, span: number, batch = true) =>
    page.evaluate(
      ({ x, z, span, batch }) => {
        const f = window.foundation,
          p = f.presentation,
          h = f.sim.hero;
        p.verticalSpan = span;
        p.resize();
        Object.assign(h, { x, z, px: x, pz: z, state: 'idle' });
        f.sim.move(h, 0, 0);
        h.px = h.x;
        h.pz = h.z;
        const renderer = p.renderer,
          composer = (p.lookRenderer as unknown as { composer: { render(ms: number): void } })
            .composer,
          render = renderer.render,
          compose = composer.render,
          suppressed = { render() {}, compose() {} };
        // Keep every animation/effect update. Only the final image is observed;
        // submitting the preceding 19 images wastes software-rasterizer work.
        try {
          if (batch) {
            renderer.render = suppressed.render;
            composer.render = suppressed.compose;
          }
          for (let i = 0; i < 19; i++) p.update(f.sim, 1, 1000 / 60, { x: 0, z: -6 });
        } finally {
          renderer.render = render;
          composer.render = compose;
        }
        p.update(f.sim, 1, 1000 / 60, { x: 0, z: -6 });
      },
      { x, z, span, batch },
    );
  const matrix: { file: string; aspect: string; span: number; name: string; stats: unknown }[] = [];
  if (run.capture) {
    for (const [aspect, w, h] of process.argv.includes('--quick')
      ? ([['16x9', 1920, 1080]] as const)
      : ([
          ['4x3', 1440, 1080],
          ['16x9', 1920, 1080],
          ['ultrawide', 2520, 1080],
        ] as const)) {
      await resize(w, h);
      for (const span of process.argv.includes('--quick') ? [9, 15] : [9, 11, 13, 15])
        for (const [name, x, z] of positions) {
          await pose(x, z, span);
          const file = `${aspect}-${span}-${name}.jpg`;
          if (run.capture)
            await page.locator('canvas').screenshot({
              path: path.join(output, file),
              type: 'jpeg',
              quality: 90,
              scale: 'css',
            });
          matrix.push({
            file,
            aspect,
            span,
            name,
            stats: await page.evaluate(() => window.foundation.stats()),
          });
        }
    }
    checks.push(`${matrix.length} composition views across camera/aspect matrix`);
  }
  if (run.capture)
    for (const [w, h, name] of [
      [2560, 1440, '1440p'],
      [3840, 2160, '4k'],
    ] as const) {
      await resize(w, h);
      await pose(0, -3.8, 9);
      if (run.capture)
        await page
          .locator('canvas')
          .screenshot({ path: path.join(output, `sanctuary-${name}.png`), scale: 'css' });
    }
  await resize(1280, 720);
  const poseControl = async (batch: boolean) => {
    await page.evaluate(async () => {
      const f = window.foundation;
      await f.fixture('upper-landing');
      f.pause(true);
      f.presentation.lookRenderer.time = 0;
    });
    await pose(0, 1, 9, batch);
  };
  await poseControl(false);
  const parity = await comparePixels(page, () => poseControl(true), { tolerance: 0 });
  assert.equal(
    parity.maxDifference,
    0,
    'Batched pose updates must preserve every pixel of the fully rendered control',
  );
  checks.push('batched pose submission preserves exact pixels of the full-render control');
  console.log(
    'Crypt pose updates: 20 state updates, one final submission; full-render pixels identical.',
  );
  await pose(0, 1, 9);
  const stationary = await page.evaluate(() => {
    const f = window.foundation,
      p = f.presentation,
      copy = document.createElement('canvas');
    p.renderer.setPixelRatio(1);
    p.renderer.setSize(1280, 720, false);
    copy.width = 1280;
    copy.height = 720;
    let before: Uint8ClampedArray | undefined,
      samples = 0;
    for (let i = 0; i < 8; i++) {
      p.update(f.sim, 1, 0, { x: 0, z: -6 });
      copy.getContext('2d')!.drawImage(p.canvas, 0, 0);
      if (i < 3) continue;
      const pixels = copy.getContext('2d')!.getImageData(0, 0, 1280, 720).data;
      if (before && pixels.some((value, index) => value !== before![index]))
        throw new Error('Stationary frozen image changed');
      before = pixels;
      samples++;
    }
    return { samples };
  });
  checks.push('frozen beauty frames have no stationary oscillation');
  const focus = await page.evaluate(() => {
    const f = window.foundation;
    f.presentation.setDepthOfField(1);
    f.presentation.update(f.sim, 1, 0, { x: 0, z: -6 });
    const mask = f.presentation.lookRenderer.focusMaskStats();
    f.presentation.setDepthOfField(0);
    return mask;
  });
  assert.ok(
    focus.protectedPixels > 100,
    'actors retain focus protection with decorative and faded art',
  );
  checks.push('DOF preserves actors and combat cues while decorative flames follow scene focus');
  // Asset IDs isolate static depth ownership from lighting, effects, and animation.
  const ids = await page.evaluate((capture) => {
    const f = window.foundation,
      p = f.presentation,
      copy = document.createElement('canvas');
    copy.width = p.canvas.width;
    copy.height = p.canvas.height;
    const swaps: {
        mesh: import('three').Mesh;
        material: import('three').Material | import('three').Material[];
        visible: boolean;
      }[] = [],
      temporaries: import('three').Material[] = [];
    const Material = (p.aim.material as import('three').MeshBasicMaterial)
      .constructor as typeof import('three').MeshBasicMaterial;
    let id = 0;
    p.roomPresentation.room.traverse((o) => {
      const mesh = o as import('three').Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material,
        source = Array.isArray(material) ? material[0]! : material;
      swaps.push({ mesh, material, visible: mesh.visible });
      if (source.transparent || source.opacity < 0.99) {
        mesh.visible = false;
        return;
      }
      const replacement = new Material({
        color: ++id,
        alphaTest: source.alphaTest,
        depthTest: source.depthTest,
        depthWrite: source.depthWrite,
        toneMapped: false,
        side: source.side,
        map: (source as import('three').MeshBasicMaterial).map,
      });
      replacement.onBeforeCompile = (s) => {
        s.fragmentShader = s.fragmentShader.replace(
          '#include <map_fragment>',
          '#ifdef USE_MAP\ndiffuseColor.a*=texture2D(map,vMapUv).a;\n#endif',
        );
      };
      replacement.customProgramCacheKey = () => 'art-id-v1';
      mesh.material = replacement;
      temporaries.push(replacement);
    });
    for (const v of p.actorPresentation.actors.values()) v.sprite.mesh.visible = false;
    const position = p.camera.position.clone(),
      auto = p.renderer.autoClear,
      color = p.renderer.getClearColor(
        new (p.light.color.constructor as typeof import('three').Color)(),
      ),
      alpha = p.renderer.getClearAlpha(),
      right = p.camera.position.clone().setFromMatrixColumn(p.camera.matrixWorld, 0),
      images: Uint8ClampedArray[] = [];
    try {
      p.renderer.autoClear = true;
      p.renderer.setClearColor(0);
      for (let i = 0; i < 13; i++) {
        p.camera.position
          .copy(position)
          .addScaledVector(right, ((p.camera.right - p.camera.left) / copy.width) * i * 0.25);
        p.camera.updateMatrixWorld();
        p.renderer.render(p.roomPresentation.room, p.camera);
        copy.getContext('2d')!.drawImage(p.canvas, 0, 0);
        images.push(copy.getContext('2d')!.getImageData(0, 0, copy.width, copy.height).data);
      }
    } finally {
      p.camera.position.copy(position);
      p.camera.updateMatrixWorld();
      p.renderer.autoClear = auto;
      p.renderer.setClearColor(color, alpha);
      for (const s of swaps) {
        s.mesh.material = s.material;
        s.mesh.visible = s.visible;
      }
      for (const m of temporaries) m.dispose();
    }
    const pixel = (bytes: Uint8ClampedArray, x: number, y: number) => {
      const i = (y * copy.width + x) * 4;
      return (bytes[i]! << 16) + (bytes[i + 1]! << 8) + bytes[i + 2]!;
    };
    const candidates: { x: number; y: number; owner: number }[] = [];
    for (let y = 4; y < copy.height - 4; y += 2)
      for (let x = 5; x < copy.width - 5; x += 2) {
        const owner = pixel(images[0]!, x, y);
        if (!owner) continue;
        let interior = true;
        for (let yy = -3; yy <= 3; yy++)
          for (let xx = -3; xx <= 3; xx++)
            if (pixel(images[0]!, x + xx, y + yy) !== owner) interior = false;
        if (interior) candidates.push({ x, y, owner });
      }
    let checked = 0,
      pixelSwaps = 0;
    for (let n = 1; n < images.length; n++)
      for (const { x, y, owner } of candidates) {
        checked++;
        if (pixel(images[n]!, Math.round(x - n * 0.25), y) !== owner) pixelSwaps++;
      }
    return {
      checked,
      swaps: pixelSwaps,
      firstImage: capture
        ? (() => {
            copy
              .getContext('2d')!
              .putImageData(
                new ImageData(new Uint8ClampedArray(images[0]!), copy.width, copy.height),
                0,
                0,
              );
            return copy.toDataURL('image/png').split(',')[1]!;
          })()
        : undefined,
    };
  }, run.capture);
  const { checked, swaps } = ids;
  assert.ok(checked > 1000, 'Depth-owner check must sample actual opaque interiors');
  assert.equal(
    swaps,
    0,
    `unexpected static depth-owner swaps at ${swaps}/${checked} interior samples`,
  );
  if (run.capture)
    await fs.writeFile(path.join(output, 'static-ids.png'), Buffer.from(ids.firstImage!, 'base64'));
  checks.push(
    `subpixel camera sweep retains static depth ownership at ${checked} interior samples`,
  );
  const foreground = await page.evaluate(async () => {
    const f = window.foundation;
    await f.fixture('upper-landing');
    f.pause(true);
    const p = f.presentation,
      hero = f.sim.hero;
    Object.assign(hero, { x: 3.4, z: 2.0, px: 3.4, pz: 2.0 });
    const frames = new Set<string>();
    let obscured = false,
      dodged = false;
    for (let tick = 0; tick < 40; tick++) {
      f.sim.step({ move: { x: 0.1, z: -0.1 }, aim: { x: 1.7, z: -1.3 }, dodge: tick === 8 });
      p.update(f.sim, 1, 1000 / 60, { x: 1.7, z: -1.3 });
      dodged ||= hero.state === 'dodge';
      obscured ||= [...p.roomPresentation.inkRoom!.occlusion.groups.values()].some(
        (group) => group.opacity < 0.99,
      );
      p.roomPresentation
        .inkRoom!.sprites.filter((sprite) => sprite.mesh.userData.emissive)
        .forEach((sprite) => frames.add(sprite.lastFrame));
    }
    const frozen = [...p.roomPresentation.inkRoom!.occlusion.groups.values()].map(
      (group) => group.opacity,
    );
    p.update(f.sim, 1, 0, { x: 1.7, z: -1.3 });
    const paused = [...p.roomPresentation.inkRoom!.occlusion.groups.values()].map(
      (group) => group.opacity,
    );
    return { obscured, dodged, drawings: frames.size, frozen, paused };
  });
  assert.ok(foreground.obscured, 'Foreground route must exercise occlusion');
  assert.ok(foreground.dodged, 'Foreground route must render a dodge');
  assert.ok(foreground.drawings > 3, 'Fixture flame loops must advance');
  assert.deepEqual(foreground.paused, foreground.frozen, 'Pause must freeze foreground opacity');
  checks.push(
    'short foreground/dodge sequence renders occlusion and advancing flames, then freezes on pause',
  );
  const replay = [];
  for (const scenario of motionCapture ? (['travel', 'foreground', 'combat'] as const) : []) {
    await page.evaluate(() => window.foundation.fixture('upper-landing'));
    await page.evaluate((scenario) => {
      const f = window.foundation;
      f.pause(true);
      document.querySelector<HTMLElement>('#modal')!.style.display = 'none';
      for (const selector of ['.title-card', '.hud', '.actions'])
        document.querySelector<HTMLElement>(selector)!.style.display = 'none';
      const h = f.sim.hero;
      if (scenario === 'foreground') Object.assign(h, { x: 3.4, z: 2.0, px: 3.4, pz: 2.0 });
      if (scenario === 'combat') Object.assign(h, { x: 0, z: 1, px: 0, pz: 1 });
      f.presentation.verticalSpan = 9;
      f.presentation.resize();
      f.presentation.renderer.setPixelRatio(1);
      f.presentation.renderer.setSize(1280, 720, false);
    }, scenario);
    const frames: Buffer[] = [],
      trace: unknown[] = [];
    for (let start = 0; start < 90; start += 10) {
      const batch = await page.evaluate(
        ({ scenario, start, motionCapture }) => {
          const f = window.foundation,
            p = f.presentation,
            copy = document.createElement('canvas');
          copy.width = 960;
          copy.height = 540;
          const frames: string[] = [],
            trace: unknown[] = [];
          for (let sample = start; sample < start + 10; sample++) {
            for (let step = 0; step < 4; step++) {
              const tick = sample * 4 + step,
                move =
                  scenario === 'travel'
                    ? { x: 0, z: -1 }
                    : scenario === 'foreground'
                      ? { x: Math.sin(tick / 50), z: -0.1 }
                      : { x: 0.12 * Math.sin(tick / 30), z: 0 };
              if (scenario === 'combat' && (tick < 140 || (tick >= 240 && tick < 280)))
                for (const enemy of f.sim.enemies) enemy.stun = 2;
              f.sim.step({
                move,
                aim: { x: 1.7, z: -1.3 },
                attack: scenario === 'combat' && [30, 105, 180].includes(tick),
                ability: scenario === 'combat' && tick >= 240 && tick < 270,
                dodge: scenario === 'foreground' && tick === 160,
              });
              p.update(f.sim, 1, 1000 / 60, { x: 1.7, z: -1.3 });
            }
            if (motionCapture) {
              copy.getContext('2d')!.drawImage(p.canvas, 0, 0, 960, 540);
              frames.push(copy.toDataURL('image/png').split(',')[1]!);
            }
            trace.push({
              tick: f.sim.tick,
              state: f.sim.hero.state,
              position: [f.sim.hero.x, f.sim.hero.z],
              attackKind: f.sim.hero.attackKind,
              flames: p.roomPresentation
                .inkRoom!.sprites.filter((s) => s.mesh.userData.emissive)
                .map((s) => s.lastFrame),
              fades: [...p.roomPresentation.inkRoom!.occlusion.groups].map(([id, g]) => ({
                id,
                opacity: g.opacity,
              })),
            });
          }
          return { frames, trace };
        },
        { scenario, start, motionCapture },
      );
      for (const image of batch.frames)
        frames.push(await sharp(Buffer.from(image, 'base64')).ensureAlpha().raw().toBuffer());
      trace.push(...batch.trace);
    }
    const delay = Array.from(
      { length: 90 },
      (_, i) => Math.round(((i + 1) * 1000) / 15) - Math.round((i * 1000) / 15),
    );
    if (motionCapture)
      for (const [speed, multiple] of [
        ['normal', 1],
        ['quarter', 4],
      ] as const) {
        const file = `${scenario}-${speed}.webp`;
        await sharp(Buffer.concat(frames), {
          raw: { width: 960, height: 540 * frames.length, channels: 4, pageHeight: 540 },
        })
          .webp({ lossless: true, effort: 2, loop: 0, delay: delay.map((d) => d * multiple) })
          .toFile(path.join(output, file));
        replay.push(file);
      }
    if (run.capture)
      await fs.writeFile(
        path.join(output, `${scenario}-trace.json`),
        JSON.stringify(trace, null, 2) + '\n',
      );
  }
  if (motionCapture) checks.push('requested travel, combat and foreground motion exports');
  const resource = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(async () => {
      await window.foundation.fixture('upper-landing');
      window.foundation.pause(true);
    });
    // Exercise all intermediate allocations for the lifetime check, including
    // transient geometry that is absent from the final composition sample.
    await pose(0, 1, 9, false);
    resource.push(await page.evaluate(() => window.foundation.stats().objects));
  }
  assert.deepEqual(resource[3], resource[1]);
  checks.push('repeated Crypt replacement retains stable GPU resources');
  assert.deepEqual(errors, []);
  await fs.rm(path.join(output, 'crypt-failure.json'), { force: true });
  const stats = await page.evaluate(() => window.foundation.stats());
  assert.ok(
    stats.atlasBytes <= 768 * 1024 * 1024,
    'runtime source and owned surface textures must fit the current budget',
  );
  await fs.writeFile(
    path.join(output, 'crypt-report.json'),
    JSON.stringify(
      {
        checks,
        matrix,
        replay,
        stationaryFrames: stationary.samples,
        subpixel: { checked, swaps },
        resource,
        stats,
        errors,
        platform: process.platform,
        limits: [
          'Hidden-window motion exports are 960x540 at 15 samples/second; native stills cover 1440p and 4K.',
          'This run certifies its host platform, not other GPUs or platforms.',
          'Character action and directional coverage remain existing supplied-art limitations.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  if (run.capture)
    await fs.writeFile(
      path.join(output, 'index.html'),
      `<!doctype html><meta charset="utf-8"><title>Crypt rebuild visual evidence</title><style>body{background:#141b21;color:#ddd;font:16px system-ui;margin:32px}img{max-width:100%;display:block;margin:20px 0}section{max-width:1280px;margin:auto}a{color:#e6c78a}</style><section><h1>Crypt rebuild visual evidence</h1><p>Native stills, composition matrix, and deterministic replays. Motion exports show 15 render samples per second.</p><img src="sanctuary-4k.png">${replay.map((v) => `<h2>${v.replace('.webp', '')}</h2><img loading="lazy" src="${v}">`).join('')}<h2>Composition matrix</h2>${matrix.map((v) => `<p>${v.aspect} · ${v.span} m · ${v.name}</p><img loading="lazy" src="${v.file}">`).join('')}</section>`,
    );
  console.log(
    `PASS: ${checks.length} Crypt gates; ${run.capture ? output : 'verified; successful diagnostics discarded'}`,
  );
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(
    path.join(output, 'crypt-failure.json'),
    JSON.stringify({ error: String(error), checks, errors }, null, 2),
  );
  throw error;
} finally {
  await run.close();
}
