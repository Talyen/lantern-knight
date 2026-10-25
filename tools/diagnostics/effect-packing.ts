import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
import { runCli } from '../cli';
import { acquireCommandLane } from '../command-lane';
import { openPreview } from '../preview-session';
import { option } from '../smoke/smoke-launch';
import { readLock } from '../assets/pack';

runCli(import.meta.url, async (flags) => {
  assert.ok(flags.includes('--output'), 'Supply an external --output directory');
  const output = path.resolve(option('--output', '', flags));
  await fs.mkdir(output, { recursive: true });
  await using temporary = await fs.mkdtempDisposable(
    path.join(os.tmpdir(), 'lantern-effect-proof-'),
  );
  const entry = path.join(temporary.path, 'main.cjs');
  await fs.writeFile(
    entry,
    "const {app,BrowserWindow}=require('electron');let window;app.setPath('userData',require('path').join(__dirname,'profile'));app.whenReady().then(()=>{window=new BrowserWindow({width:400,height:400,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});window.loadURL('about:blank');});app.on('window-all-closed',()=>app.quit());",
  );
  const lane = await acquireCommandLane({ waitMs: 30000 });
  try {
    const preview = await openPreview({
      output: 'development',
      assets: 'pinned',
      scope: 'authoring',
      demand: true,
      port: Number(process.env.LANTERN_PREVIEW_PORT ?? 5175),
    });
    try {
      const app = await _electron.launch({
        executablePath: createRequire(import.meta.url)('electron') as string,
        args: [
          entry,
          ...(process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : []),
        ],
      });
      try {
        const page = await app.firstWindow();
        page.on('console', (message) => {
          if (message.type() === 'error' || message.text().startsWith('Packing proof:'))
            console.log(message.text());
        });
        page.on('pageerror', (error) => console.error(error));
        await page.route('**/packing-proof.html', (route) =>
          route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }),
        );
        await page.goto(preview.origin + '/packing-proof.html');
        const result = await page.evaluate(async () => {
          const modulePath = '/tests/fixtures/game-effect-packing.ts';
          return (await import(modulePath)).gameEffectPackingProof(true);
        });
        const { images, ...record } = result;
        for (const image of images) {
          await fs.writeFile(
            path.join(output, image.asset + '-before.png'),
            Buffer.from(image.before, 'base64'),
          );
          await fs.writeFile(
            path.join(output, image.asset + '-after.png'),
            Buffer.from(image.after, 'base64'),
          );
        }
        await fs.writeFile(
          path.join(output, 'proof.json'),
          JSON.stringify({ ...record, assetPin: (await readLock()).sha256 }, null, 2),
        );
        console.log(JSON.stringify(record));
        assert.doesNotMatch(
          record.renderer,
          /swiftshader|llvmpipe|software|unavailable/i,
          'Native parity requires an observed hardware GPU',
        );
        assert.ok(record.visibleFrames > 400, 'Real effect pixels must be drawn');
        assert.ok(
          record.maxDifference <= 2 && record.rmsDifference < 0.1,
          'Native packing must retain the reviewed filtering error bound; decoded source pixels are checked separately',
        );
      } finally {
        await app.close();
      }
    } finally {
      await preview.close();
    }
  } finally {
    await lane.release();
  }
});
