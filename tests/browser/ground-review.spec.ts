import { readJson } from '../../tools/json-file';
import { pixelTest as test, expect, waitForEditor } from './fixtures';
import fs from 'node:fs/promises';
import path from 'node:path';

test('review authored occluders from reachable front and behind positions', async ({
  page,
}, info) => {
  const id = process.env.LANTERN_GROUND_REVIEW;
  test.skip(!id, 'Opt in for captures of a prepared authored scene');
  test.setTimeout(1_800_000);
  page.setDefaultTimeout(30_000);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/editor.html?automated');
  await waitForEditor(page, 30_000);
  console.info('Review: editor ready');
  if (await page.getByRole('button', { name: 'Dismiss', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.locator('#document-menu > summary').click();
  await page.locator('#scene').selectOption('file-' + id!);
  await page.locator('#open').click();
  await page.locator('#confirmation-accept').click();
  await page.waitForFunction(() => window.sceneEditor.view().presentation?.groundOcclusion);
  console.info('Review: authored atlas ready');
  await page.locator('#scene-tab').click();
  await page.locator('#ground-interaction-section > summary').click();
  for (const key of ['masks', 'blockers', 'depth'])
    await page.locator('#ground-show-' + key).uncheck();
  console.info('Review: overlays hidden');
  const report = await page.evaluate(async () => {
    const floorPath = '/src/content/floor-layout.ts',
      navigationPath = '/src/core/navigation.ts',
      collisionPath = '/src/content/collision.ts',
      depthPath = '/src/presentation/ground-occlusion.ts',
      cameraPath = '/src/presentation/camera.ts';
    const { artworkFloorLayout } = await import(floorPath),
      { Navigation } = await import(navigationPath),
      { clearSegment } = await import(collisionPath),
      { regionDepth, GroundOcclusion } = await import(depthPath),
      { outward } = await import(cameraPath),
      view = window.sceneEditor.view(),
      sim = view.sim!,
      p = view.presentation!,
      d = window.sceneEditor.state().document,
      layout = artworkFloorLayout(d.floor.width, d.floor.depth),
      navigation = new Navigation(sim.areaDefinition),
      radius = Math.max(0.3, sim.hero.definition.radius),
      axis = {
        x: outward.x / Math.hypot(outward.x, outward.z),
        z: outward.z / Math.hypot(outward.x, outward.z),
      };
    const compilationStart = performance.now();
    const atlas = new GroundOcclusion(
      d.groundInteraction!,
      d.floor.width,
      d.floor.depth,
      p.renderer.capabilities.maxTextureSize,
    );
    const atlasCompilationMilliseconds = performance.now() - compilationStart;
    atlas.dispose();
    const regions = d
      .groundInteraction!.regions.filter((r) => r.mask?.length && r.depth)
      .map((region) => {
        const base =
          region.depth!.kind === 'anchor'
            ? region.depth!.point
            : region.depth!.points[Math.floor(region.depth!.points.length / 2)]!;
        const approaches: { x: number; z: number; side: string }[] = [];
        for (const side of [-1, 1]) {
          let found = false;
          for (const along of [0.8, 1.2, 1.8, 2.4]) {
            for (const across of [0, -0.6, 0.6, -1.2, 1.2, -1.8, 1.8]) {
              const point = {
                x: base.x + axis.x * along * side + axis.z * across,
                z: base.z + axis.z * along * side - axis.x * across,
              };
              if (!clearSegment(sim.areaDefinition, point, point, radius)) continue;
              const depth = point.x * outward.x + point.z * outward.z,
                threshold = regionDepth(region, layout.uv(point)[0], layout);
              if (depth < threshold !== side < 0) continue;
              if (navigation.route(d.hero, point, radius).status !== 'ready') continue;
              approaches.push({ ...point, side: side < 0 ? 'behind' : 'front' });
              found = true;
              break;
            }
            if (found) break;
          }
        }
        return { id: region.id, name: region.name, base, approaches };
      });
    return { id: d.id, atlasCompilationMilliseconds, regions };
  });
  console.info('Review: approaches validated', report.regions.length);
  expect(report.regions.length).toBeGreaterThan(0);
  const resume = process.env.LANTERN_GROUND_REVIEW_RESUME;
  const captured: string[] = resume
    ? (await readJson(path.join(resume, 'review.json'))).captured
    : [];
  if (resume)
    for (const id of captured)
      await fs.copyFile(path.join(resume, id + '.png'), info.outputPath(id + '.png'));
  const saveReport = () =>
    fs.writeFile(info.outputPath('review.json'), JSON.stringify({ ...report, captured }, null, 2));
  await saveReport();
  for (const region of report.regions) {
    if (!region.approaches.length || captured.includes(region.id)) continue;
    const capture = await page.evaluate(({ base, approaches }) => {
      const view = window.sceneEditor.view(),
        p = view.presentation!,
        sim = view.sim!;
      p.verticalSpan = 7;
      p.center.set(base.x, 0, base.z);
      for (const [index, actor] of sim.actors.entries()) {
        const point = approaches[index];
        Object.assign(actor, {
          x: point?.x ?? 100,
          z: point?.z ?? 100,
          px: point?.x ?? 100,
          pz: point?.z ?? 100,
          y: 0,
          py: 0,
          state: 'idle',
        });
      }
      view.render();
      return view.canvas.toDataURL('image/png');
    }, region);
    await fs.writeFile(
      info.outputPath(region.id + '.png'),
      Buffer.from(capture.split(',')[1]!, 'base64'),
    );
    captured.push(region.id);
    await saveReport();
  }
});
