import fs from 'node:fs/promises';
import path from 'node:path';
import { pixelTest as test, expect } from './fixtures';

test('camera shutter changes moving scenery and clears on stop or reduced motion', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 400, height: 300 });
  await page.goto('/sandbox.html?scene=orchard-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  const proof = await page.evaluate((capture) => {
    const f = window.foundation,
      p = f.presentation;
    f.pause(true);
    // This proof owns shutter pixels. Lighting, shadow and cohesion proofs own
    // the unrelated passes; do not redraw their full maps for each shutter sample.
    p.lookRenderer.setSettings({
      lighting: false,
      shadows: false,
      groundBounce: false,
      depthOfField: 0,
    });
    p.setVisualEffects({
      motionBlur: true,
      wind: false,
      atmosphere: false,
      livingLights: false,
      rain: false,
      smoke: false,
      bloom: false,
      surfaceDepth: false,
      relief: false,
      palette: false,
    });
    p.update(f.sim, 1, 0, { x: 0, z: 1 });
    const frame = {
      visuals: p.visuals,
      visualEffects: p.visualEffects,
      cameraTarget: p.camera.position.clone().set(f.sim.hero.x, f.sim.hero.y, f.sim.hero.z),
      viewSpan: p.verticalSpan,
    };
    const draw = (reducedMotion = false) => {
      p.lookRenderer.render(f.sim, 1000 / 60, { ...frame, reducedMotion });
      const gl = p.renderer.getContext(),
        pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      return { pixels, image: capture ? p.canvas.toDataURL() : undefined };
    };
    draw();
    const right = p.camera.position.clone().set(1, 0, 0).applyQuaternion(p.camera.quaternion);
    p.camera.position.addScaledVector(right, 0.12);
    p.camera.updateMatrixWorld();
    const moving = draw(),
      stopped = draw();
    p.visualEffects.motionBlur = false;
    const off = draw();
    p.visualEffects.motionBlur = true;
    draw();
    p.camera.position.addScaledVector(right, 0.12);
    p.camera.updateMatrixWorld();
    const reduced = draw(true);
    p.visualEffects.motionBlur = false;
    const reducedOff = draw();
    const changes = (a: Uint8Array, b: Uint8Array) =>
      a.reduce((n, v, i) => n + Number(Math.abs(v - b[i]!) > 2), 0);
    return {
      movingChanges: changes(moving.pixels, off.pixels),
      stoppedChanges: changes(stopped.pixels, off.pixels),
      reducedChanges: changes(reduced.pixels, reducedOff.pixels),
      off: off.image,
      on: moving.image,
      error: p.renderer.getContext().getError(),
    };
  }, !!process.env.LANTERN_MOTION_BLUR_CAPTURES);
  expect(proof.error).toBe(0);
  expect(proof.movingChanges).toBeGreaterThan(500);
  expect(proof.stoppedChanges).toBe(0);
  expect(proof.reducedChanges).toBe(0);
  if (process.env.LANTERN_MOTION_BLUR_CAPTURES) {
    await fs.mkdir(process.env.LANTERN_MOTION_BLUR_CAPTURES, { recursive: true });
    for (const key of ['off', 'on'] as const)
      await fs.writeFile(
        path.join(process.env.LANTERN_MOTION_BLUR_CAPTURES, key + '.png'),
        Buffer.from(proof[key]!.split(',')[1]!, 'base64'),
      );
  }
});
