import fs from 'node:fs/promises';
import { test, expect } from './fixtures';
import type { SceneSnapshot } from '../../src/content/scene-document';

// Compare the actual presentations with identical assets, pose, viewport and time.
// This catches editor-only framing/lighting drift without freezing scene artwork.
for (const id of [
  'abandoned-orchard',
  'forest-gathering-clearing',
  'ruined-forge',
  'desecrated-chapel',
  'woodland',
]) {
  test(`Game camera and lantern match the editor in ${id}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1000, height: 720 });
    await page.goto('/editor.html?automated');
    await page.waitForFunction(() => window.sceneEditor?.ready());
    const document = JSON.parse(
      await fs.readFile('authoring/scenes/' + id + '.json', 'utf8'),
    ) as SceneSnapshot;
    const proof = await page.evaluate(async (document) => {
      const gamePath = '/src/presentation/game-scene.ts',
        eventsPath = '/src/core/events.ts';
      const { GamePresentation } = await import(gamePath),
        { EventHub } = await import(eventsPath);
      const view = window.sceneEditor.view();
      view.setAnimationPlaying(false);
      await view.apply(document);
      view.setGrid(false);
      view.select(undefined);
      view.setGameCamera(true);
      const editor = view.presentation!,
        sim = view.sim!,
        canvas = window.document.createElement('canvas');
      canvas.style.position = 'fixed';
      canvas.style.left = '-10000px';
      canvas.style.top = '0';
      canvas.style.width = editor.canvas.clientWidth + 'px';
      canvas.style.height = editor.canvas.clientHeight + 'px';
      window.document.body.append(canvas);
      const game = new GamePresentation(
        canvas,
        editor.packs,
        new EventHub(),
        editor.area,
        editor.registration,
        editor.visualOverride,
      );
      try {
        const stable = {
          livingLights: false,
          smoke: false,
          rain: false,
          wind: false,
          atmosphere: false,
        };
        editor.setVisualEffects(stable);
        game.setVisualEffects(stable);
        editor.renderer.setPixelRatio(1);
        view.resize();
        game.renderer.setPixelRatio(1);
        game.resize();
        await game.loadAnimationFlow();
        await game.warm();
        // The editor omits the game cursor; exclude that overlay from the comparison.
        game.aim.material.opacity = 0;
        game.generation = sim.generation;
        game.update(sim.view, 1, 0, sim.hero);
        // Editor RAF may advance breathing while the second renderer warms.
        for (const p of [editor, game])
          for (const actor of p.actorPresentation.actors.values()) actor.sprite.animator.time = 0;
        view.render();
        game.update(sim.view, 1, 0, sim.hero);
        const read = (p: typeof editor) => {
          const gl = p.renderer.getContext();
          const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(
            0,
            0,
            gl.drawingBufferWidth,
            gl.drawingBufferHeight,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          return pixels;
        };
        const a = read(editor),
          b = read(game);
        let different = 0;
        for (let i = 0; i < a.length; i += 4)
          if (Math.max(...[0, 1, 2].map((c) => Math.abs(a[i + c]! - b[i + c]!))) > 3) different++;
        const cameraError = Math.max(
          ...editor.camera.projectionMatrix.elements.map((v, i) =>
            Math.abs(v - game.camera.projectionMatrix.elements[i]!),
          ),
          ...editor.camera.matrixWorld.elements.map((v, i) =>
            Math.abs(v - game.camera.matrixWorld.elements[i]!),
          ),
        );
        sim.hero.state = 'walk';
        sim.hero.px = sim.hero.x - 0.1;
        game.update(sim.view, 1, 80, sim.hero);
        view.render(80);
        const walkingEditor = read(editor),
          walkingGame = read(game);
        let walkingDifferent = 0;
        for (let i = 0; i < walkingEditor.length; i += 4)
          if (
            Math.max(
              ...[0, 1, 2].map((c) => Math.abs(walkingEditor[i + c]! - walkingGame[i + c]!)),
            ) > 3
          )
            walkingDifferent++;
        different = Math.max(different, walkingDifferent);
        const images =
          different / (a.length / 4) >= 0.005
            ? {
                editor: editor.canvas.toDataURL('image/png'),
                game: game.canvas.toDataURL('image/png'),
              }
            : undefined;
        const lights = game.lookRenderer.lighting.common;
        const power = lights.inkLightPower.value[0];
        // Render an otherwise identical frame with only the hero lamp removed.
        lights.inkLightPower.value[0] = 0;
        game.renderer.setRenderTarget(null);
        game.renderer.render(game.scene, game.camera);
        const unlit = read(game);
        lights.inkLightPower.value[0] = power;
        game.renderer.render(game.scene, game.camera);
        const lit = read(game);
        let illuminated = 0,
          red = 0,
          blue = 0;
        for (let i = 0; i < lit.length; i += 4) {
          if (lit[i]! + lit[i + 1]! + lit[i + 2]! > unlit[i]! + unlit[i + 1]! + unlit[i + 2]! + 9) {
            illuminated++;
            red += lit[i]! - unlit[i]!;
            blue += lit[i + 2]! - unlit[i + 2]!;
          }
        }
        return {
          cameraError,
          images,
          different: different / (a.length / 4),
          illuminated,
          red,
          blue,
          power,
        };
      } finally {
        game.dispose();
        canvas.remove();
      }
    }, document);
    if (proof.images)
      for (const [name, image] of Object.entries(proof.images))
        await testInfo.attach(id + '-' + name, {
          body: Buffer.from(image.split(',')[1]!, 'base64'),
          contentType: 'image/png',
        });
    console.log(id, { different: proof.different, illuminated: proof.illuminated });
    expect(proof.cameraError, id).toBeLessThan(1e-8);
    expect(proof.different, id).toBeLessThan(0.01);
    expect(proof.illuminated, id).toBeGreaterThan(1000);
    expect(proof.red, id).toBeGreaterThan(proof.blue);
    expect(proof.power, id).toBeGreaterThan(1.35);
    // Navigation controls must still release the game camera for composition.
    await page.locator('#view-menu').evaluate((e: HTMLDetailsElement) => (e.open = true));
    await page.locator('#fit').click();
    expect(await page.evaluate(() => window.sceneEditor.view().presentation!.gameCamera)).toBe(
      false,
    );
    await page.locator('#view-menu').evaluate((e: HTMLDetailsElement) => (e.open = true));
    await page.locator('#reset-game-zoom').click();
    expect(await page.evaluate(() => window.sceneEditor.view().presentation!.gameCamera)).toBe(
      true,
    );
  });
}
