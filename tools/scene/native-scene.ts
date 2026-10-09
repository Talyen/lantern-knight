import { smokeLaunch, option } from '../smoke/smoke-launch';
import { AssetCache } from '../assets/cache';
import { sandboxContent } from '../../src/content/sandbox-world';
import { worldVisuals } from '../../src/content/world-art';
import { sceneFixture } from './scene-fixtures';
import {
  traverseScene,
  checkForeground,
  checkSurround,
  checkRoomLifetime,
  checkPreviewReload,
  captureScene,
  benchmarkSurround,
} from './scene-scenarios';
export async function nativeScene(flags: string[]) {
  const scene = option('--scene', 'court', flags),
    area = sandboxContent.area(scene),
    art = worldVisuals[scene],
    fixture = sceneFixture(scene, area.entries[0]!);
  const run = await smokeLaunch(true, [], { flags }),
    held = await new AssetCache().lease('scene-native-' + process.pid);
  try {
    await run.page.evaluate(async (scene) => {
      await window.foundation.fixture(scene);
    }, scene);
    const context = {
      page: run.page,
      browser: run.app,
      scene,
      area,
      art,
      route: fixture.route,
      foreground: fixture.foreground,
      held,
      initialLook: await run.page.evaluate(() => ({
        ...window.foundation.presentation.lookRenderer.settings,
      })),
      capture: flags.includes('--capture'),
      benchmark: flags.includes('--benchmark'),
    };
    await traverseScene(context);
    await checkForeground(context);
    await checkSurround(context);
    await checkRoomLifetime(context);
    await checkPreviewReload(context);
    if (context.benchmark) console.log(await benchmarkSurround(context));
    await captureScene(context);
  } finally {
    await run.close();
    await held.release();
  }
}
