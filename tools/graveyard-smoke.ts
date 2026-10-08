import { smokeLaunch } from './smoke-launch';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { _electron } from 'playwright';
import sharp from 'sharp';
import * as T from 'three';
import '../src/inspection';
const launch = await smokeLaunch(true, [], {
    budget: process.argv.includes('--capture') ? 1024 ** 3 : 32 * 1024 ** 2,
  }),
  { output, profile, app, page, errors } = launch,
  quick = process.argv.includes('--quick') || !launch.capture,
  stills = process.argv.includes('--stills') || !launch.capture;
const checks: string[] = [],
  gallery: unknown[] = [],
  timings: unknown[] = [];
const capture = async (file: string) => {
  const result = await page.evaluate(() => {
    const f = window.foundation,
      p = f.presentation;
    p.update(f.sim, 1, 0, { x: f.sim.hero.x + 1, z: f.sim.hero.z });
    const copy = document.createElement('canvas');
    copy.width = p.canvas.width;
    copy.height = p.canvas.height;
    copy.getContext('2d')!.drawImage(p.canvas, 0, 0);
    const root = p.camera.position
        .clone()
        .set(f.sim.hero.x, f.sim.hero.y, f.sim.hero.z)
        .project(p.camera),
      head = p.camera.position
        .clone()
        .set(f.sim.hero.x, f.sim.hero.y + 1.8, f.sim.hero.z)
        .project(p.camera);
    return {
      png: copy.toDataURL('image/png').split(',')[1]!,
      root: { x: root.x, y: root.y },
      head: { x: head.x, y: head.y },
    };
  });
  assert.ok(
    Math.abs(result.root.x) < 1 && result.root.y > -1 && result.head.y < 1,
    `hero framing failed in ${file}`,
  );
  const b = Buffer.from(result.png, 'base64');
  if (launch.capture) await fs.writeFile(path.join(output, file), b);
  return b;
};
async function pose(x: number, z: number) {
  await page.evaluate(
    ({ x, z }) => {
      const f = window.foundation,
        h = f.sim.hero;
      Object.assign(h, { x, z, px: x, pz: z, state: 'idle' });
      f.sim.move(h, 0, 0);
      h.px = h.x;
      h.pz = h.z;
      for (let i = 0; i < 24; i++) f.presentation.update(f.sim, 1, 1000 / 60, { x: x + 1, z });
    },
    { x, z },
  );
}
async function size(width: number, height: number) {
  const dpr = await page.evaluate(() => devicePixelRatio);
  await app.evaluate(
    ({ BrowserWindow }, { width, height, dpr }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(
        Math.ceil(width / dpr),
        Math.ceil(height / dpr) + 128,
      ),
    { width, height, dpr },
  );
  await page.waitForTimeout(80);
  const actual = await page.evaluate(() => window.foundation.stats().buffer);
  assert.deepEqual(actual, [width, height], `native canvas mismatch for ${width}×${height}`);
}
const looks = [
  ['arrival', -3.3, 6.65],
  ['burial-court', 0.4, 1.5],
  ['chapel-reveal', 0, -2.4],
  ['porch', 0, -5.5],
  ['old-tree', -2.7, -1.9],
  ['family-plot', 2.65, -2],
  ['disturbed', -2.7, -3.45],
  ['tended', 2.7, -3.55],
] as const;
type Diagnostic = {
  width: number;
  height: number;
  owners: string[];
  viewProjection: number[];
  ids: string;
  depth: string;
};
async function diagnostic() {
  return page.evaluate(() => {
    const d = window.foundation.presentation.captureArtDiagnostics(),
      encoded = [d.ids, d.depth].map((a) => {
        const bytes = new Uint8Array(a.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      });
    return { ...d, ids: encoded[0]!, depth: encoded[1]! };
  }) as Promise<Diagnostic>;
}

function unpack(d: Diagnostic) {
  const ib = Buffer.from(d.ids, 'base64'),
    db = Buffer.from(d.depth, 'base64');
  return {
    ...d,
    ids: new Uint16Array(ib.buffer.slice(ib.byteOffset, ib.byteOffset + ib.byteLength)),
    depth: new Float32Array(db.buffer.slice(db.byteOffset, db.byteOffset + db.byteLength)),
  };
}
try {
  await page.waitForFunction(
    () => window.foundation?.ready && window.foundation.presentation.lookRenderer.ready,
    {},
    { timeout: 60000 },
  );
  await page.evaluate(async () => {
    const f = window.foundation;
    await f.fixture('court');
    f.mode('encounter');
    f.pause(true);
    for (const selector of [
      '#modal',
      '.title-card',
      '.hud',
      '.actions',
      '#lighting-lab',
      '#occlusion',
    ]) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) el.hidden = true;
    }
  });
  const widths = quick
    ? [[1920, 1080]]
    : stills
      ? [
          [1920, 1080],
          [3840, 2160],
        ]
      : [
          [1920, 1080],
          [2560, 1440],
          [3840, 2160],
        ];
  for (const [width, height] of widths) {
    await size(width!, height!);
    for (const span of quick || stills ? [9] : [9, 11, 13, 15]) {
      await page.evaluate((span) => {
        const p = window.foundation.presentation;
        p.verticalSpan = span;
        p.resize();
      }, span);
      for (const [name, x, z] of quick ? looks.slice(0, 3) : looks) {
        await pose(x, z);
        const file = `${width}-${height}-${span}-${name}.png`,
          bytes = await capture(file);
        if (launch.capture && width === 1920 && span === 9)
          await sharp(bytes)
            .grayscale()
            .png()
            .toFile(path.join(output, file.replace('.png', '-grayscale.png')));
        const stats = await sharp(bytes).stats();
        assert.ok(stats.channels.slice(0, 3).some((c) => c.stdev > 8));
        gallery.push({ file, width, height, span, name });
      }
      console.log(`Native stills ${width}×${height}, span ${span}`);
    }
  }
  checks.push(
    'hero silhouette stays inside every captured frame; grayscale stills support value hierarchy review',
  );
  checks.push(
    quick
      ? 'three representative composition poses verified'
      : 'full native composition/framing matrix verified',
  );
  if (!quick)
    for (const [width, height] of [
      [2560, 1080],
      [1080, 1920],
    ]) {
      await size(width!, height!);
      for (const span of stills ? [9] : [9, 15]) {
        await page.evaluate((span) => {
          const p = window.foundation.presentation;
          p.verticalSpan = span;
          p.resize();
        }, span);
        for (const [name, x, z] of [looks[0], looks[1], looks[3]]) {
          await pose(x, z);
          const file = `${width}-${height}-${span}-${name}-aspect.png`;
          await capture(file);
          gallery.push({ file, width, height, span, name: `${name}-aspect` });
        }
      }
    }
  await size(1920, 1080);
  await page.evaluate(() => {
    const f = window.foundation;
    f.mode('occlusion');
    f.presentation.debug = true;
    f.pause(true);
    document.querySelector<HTMLElement>('#modal')!.hidden = true;
  });
  await pose(0, 1);
  assert.deepEqual(
    await page.evaluate(() => window.foundation.presentation.artConstruction.findings),
    [],
  );
  await capture('registration-overlay.png');
  checks.push(
    'developer registration overlay reports no undeclared footprint or coplanar conflicts',
  );
  await page.evaluate(() => {
    const f = window.foundation;
    f.mode('lighting');
    f.pause(true);
    f.presentation.debug = false;
    document.querySelector<HTMLElement>('#modal')!.hidden = true;
    document.querySelector<HTMLElement>('#lighting-lab')!.hidden = true;
    f.presentation.verticalSpan = 9;
    f.presentation.resize();
    f.presentation.lookRenderer.setSettings({
      lighting: false,
      shadows: false,
      atmosphere: false,
      postprocessing: false,
      depthOfField: 0,
    });
  });
  await pose(-3.3, 7.25);
  const policy = await page.evaluate(() =>
    window.foundation.presentation.inkRoom!.graveyard!.revealStats(),
  );
  for (const [i, z] of [7.29, 7.25, 7.29, 7.25].entries()) {
    await page.evaluate((z) => {
      const f = window.foundation;
      Object.assign(f.sim.hero, { z, pz: z });
      f.presentation.update(f.sim, 1, 1000 / 60, { x: 4, z });
    }, z);
    const states = await page.evaluate(() =>
      window.foundation.presentation.inkRoom!.graveyard!.revealStats(),
    );
    assert.ok(
      states.every(
        (s, i) =>
          s.opacity === 1 &&
          s.depthWrite === policy[i]!.depthWrite &&
          s.transparent === policy[i]!.transparent,
      ),
    );
    await capture(`wall-reversal-${i}.png`);
  }
  checks.push(
    'four-centimetre reversals do not toggle opacity, alpha thresholds or depth-writing state',
  );
  // Fixed scenery is reprojected through actual depth, excluding the actors and animated sources.
  await size(1280, 720);
  await page.evaluate(() => {
    const p = window.foundation.presentation;
    p.verticalSpan = 11;
    p.resize();
  });
  let previous: ReturnType<typeof unpack> | undefined;
  const ownership = [];
  for (const [x, z] of [
    [0, 1],
    [0.013, 1.012],
    [0.029, 1.026],
    [0.041, 1.035],
    [0.053, 1.042],
  ]) {
    await pose(x!, z!);
    const d = unpack(await diagnostic());
    assert.ok(d.ids.some((n) => n > 0));
    assert.ok(d.depth.some((n) => n > 0 && n < 1));
    let compared = 0,
      changes = 0;
    const conflicts: unknown[] = [];
    if (previous) {
      assert.deepEqual(d.owners, previous.owners);
      const inverse = new T.Matrix4().fromArray(d.viewProjection).invert(),
        oldVP = new T.Matrix4().fromArray(previous.viewProjection),
        p = new T.Vector3();
      for (let y = 3; y < d.height - 3; y += 3)
        for (let xx = 3; xx < d.width - 3; xx += 3) {
          const i = y * d.width + xx,
            id = d.ids[i]!;
          if (!id || d.depth[i]! <= 0) continue;
          let solid = true;
          for (const [ox, oy] of [
            [-2, 0],
            [2, 0],
            [0, -2],
            [0, 2],
          ])
            if (d.ids[i + oy! * d.width + ox!] !== id) solid = false;
          if (!solid) continue;
          p.set(((xx + 0.5) / d.width) * 2 - 1, ((y + 0.5) / d.height) * 2 - 1, d.depth[i]! * 2 - 1)
            .applyMatrix4(inverse)
            .applyMatrix4(oldVP);
          const px = Math.floor((p.x * 0.5 + 0.5) * d.width),
            py = Math.floor((p.y * 0.5 + 0.5) * d.height);
          if (px < 3 || py < 3 || px >= d.width - 3 || py >= d.height - 3) continue;
          const old = py * d.width + px;
          for (const [ox, oy] of [
            [-2, 0],
            [2, 0],
            [0, -2],
            [0, 2],
          ])
            if (previous.ids[old + oy! * d.width + ox!] !== previous.ids[old]) solid = false;
          if (!solid) continue;
          compared++;
          if (previous.ids[old] !== id) {
            changes++;
            if (conflicts.length < 100)
              conflicts.push({
                x: xx,
                y,
                owner: d.owners[id],
                prior: previous.owners[previous.ids[old]!],
                depth: d.depth[i],
                world: new T.Vector3(
                  ((xx + 0.5) / d.width) * 2 - 1,
                  ((y + 0.5) / d.height) * 2 - 1,
                  d.depth[i]! * 2 - 1,
                )
                  .applyMatrix4(inverse)
                  .toArray(),
              });
          }
        }
      assert.ok(compared > 10000);
      if (changes)
        await fs.writeFile(
          path.join(output, 'ownership-conflicts.json'),
          JSON.stringify(conflicts, null, 2),
        );
      assert.equal(
        changes,
        0,
        'static scenery ownership changed during subpixel camera translation',
      );
      ownership.push({ x, z, compared, changes });
    }
    if (launch.capture && !previous) {
      const pixels = Buffer.alloc(d.width * d.height * 3);
      for (let i = 0; i < d.ids.length; i++) {
        const n = d.ids[i]!;
        pixels[i * 3] = (n * 71) % 256;
        pixels[i * 3 + 1] = (n * 137) % 256;
        pixels[i * 3 + 2] = (n * 193) % 256;
      }
      await sharp(pixels, { raw: { width: d.width, height: d.height, channels: 3 } })
        .flip()
        .png()
        .toFile(path.join(output, 'ownership-id.png'));
      await fs.writeFile(
        path.join(output, 'ownership-labels.json'),
        JSON.stringify(d.owners, null, 2),
      );
    }
    previous = d;
  }
  await fs.writeFile(path.join(output, 'ownership.json'), JSON.stringify(ownership, null, 2));
  checks.push(
    'object ID/depth reprojection shows no static ownership flips during subpixel camera movement',
  );
  await size(1920, 1080);
  await page.evaluate(() => {
    const f = window.foundation;
    f.mode('encounter');
    f.pause(true);
    document.querySelector<HTMLElement>('#modal')!.hidden = true;
    f.presentation.verticalSpan = 9;
    f.presentation.setDepthOfField(0);
    f.presentation.resize();
  });
  const routes = [
    {
      name: 'approach',
      points: [
        [-3.3, 6.65],
        [-2.5, 4.7],
        [-0.2, 2.25],
        [0.6, -0.3],
        [0.45, -2.8],
        [0, -5.6],
      ],
    },
    {
      name: 'boundary',
      points: [
        [2.5, 4.5],
        [2.65, 0.4],
        [2.65, -3.8],
        [0, -4.2],
        [-2.7, -2.3],
        [-2.4, 2.5],
      ],
    },
  ];
  for (const route of stills ? [] : quick ? routes.slice(0, 1) : routes)
    for (const speed of quick ? [1] : [1, 0.25]) {
      const recording = await page.evaluate(
        async ({ points, speed }) => {
          const f = window.foundation,
            p = f.presentation,
            canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext('2d')!,
            stream = canvas.captureStream(0),
            chunks: Blob[] = [],
            recorder = new MediaRecorder(stream, {
              mimeType: 'video/webm;codecs=vp9',
              videoBitsPerSecond: 6000000,
            }),
            costs: number[] = [];
          recorder.ondataavailable = (e) => chunks.push(e.data);
          recorder.start();
          for (let segment = 0; segment < points.length - 1; segment++) {
            const a = points[segment]!,
              b = points[segment + 1]!,
              frames = Math.ceil((Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / 1.8) * 30);
            for (let i = 0; i <= frames; i++) {
              const t = i / frames,
                h = f.sim.hero;
              Object.assign(h, {
                x: a[0]! + (b[0]! - a[0]!) * t,
                z: a[1]! + (b[1]! - a[1]!) * t,
                state: 'walk',
                yaw: Math.atan2(b[0]! - a[0]!, b[1]! - a[1]!),
              });
              f.sim.move(h, 0, 0);
              h.px = h.x;
              h.pz = h.z;
              p.update(f.sim, 1, 1000 / 30, { x: h.x + 1, z: h.z });
              costs.push(p.lookRenderer.stats().frameCost.cpuSubmissionMs);
              ctx.drawImage(p.canvas, 0, 0, canvas.width, canvas.height);
              (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack).requestFrame();
              await new Promise((r) => setTimeout(r, 1000 / 30 / speed));
            }
          }
          await new Promise<void>((r) => {
            recorder.onstop = () => r();
            recorder.stop();
          });
          stream.getTracks().forEach((t) => t.stop());
          const bytes = new Uint8Array(
            await new Blob(chunks, { type: 'video/webm' }).arrayBuffer(),
          );
          let binary = '';
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          return { video: btoa(binary), costs, stats: p.stats() };
        },
        { points: route.points, speed },
      );
      const file = `${route.name}-${speed === 1 ? 'normal' : 'quarter'}.webm`;
      await fs.writeFile(path.join(output, file), Buffer.from(recording.video, 'base64'));
      timings.push({
        file,
        stats: recording.stats,
        frames: recording.costs.length,
        cpuMedian: recording.costs.sort((a, b) => a - b)[Math.floor(recording.costs.length / 2)],
      });
      console.log(`Motion ${file}`);
    }
  if (!stills)
    checks.push(
      'normal and quarter-speed traversals cover path bends, boundary occlusion, woodland, family plot and threshold',
    );
  await pose(0, 1);
  const paused = await capture('paused.png');
  assert.equal(
    createHash('sha256')
      .update(await capture('paused-repeat.png'))
      .digest('hex'),
    createHash('sha256').update(paused).digest('hex'),
  );
  checks.push('paused scene has identical pixels, including ambient effects and local reveals');
  await page.evaluate(() => window.foundation.presentation.setDepthOfField(0.45));
  await capture('saved-dof.png');
  assert.ok(
    (await page.evaluate(
      () => window.foundation.presentation.lookRenderer.focusMaskStats().protectedPixels,
    )) > 0,
  );
  await page.evaluate(() => window.foundation.presentation.setDepthOfField(0));
  checks.push('an explicitly saved nonzero DOF setting retains fighter focus protection');
  assert.deepEqual(errors, []);
  await fs.rm(path.join(output, 'failure.json'), { force: true });
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        quick,
        stills,
        checks,
        gallery,
        timings,
        errors,
        scope:
          'macOS development Electron/WebGL2 build. Native stills and 1280×720 replay videos; hidden-window timings do not certify visible display pacing or Windows.',
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${checks.length} Graveyard checks; ${launch.capture ? output : 'successful diagnostics discarded'}`,
  );
} catch (e) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ error: String(e), errors, checks, gallery }, null, 2),
  );
  throw e;
} finally {
  await launch.close();
}
