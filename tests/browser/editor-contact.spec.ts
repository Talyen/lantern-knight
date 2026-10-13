import { test, expect } from './fixtures';
import type {} from '../../src/editor/main';

for (const layout of ['repeat', 'artwork'] as const)
  test(`editor renders walking hero and prop contact shadows on ${layout} floors with independent contact and silhouette shadows`, async ({
    page,
  }) => {
    await page.goto('/editor.html?automated');
    await page.waitForFunction(() => window.sceneEditor?.ready());
    const pixels = await page.evaluate(async (layout) => {
      const editor = window.sceneEditor,
        view = editor.view(),
        document = {
          ...structuredClone(editor.state().document),
          floor: {
            ...editor.state().document.floor,
            layout: layout === 'artwork' ? layout : undefined,
          },
          objects: [
            {
              id: 'grounded-prop',
              kind: 'prop' as const,
              asset: 'ink-scenery',
              clip: 'gravestone',
              x: 2,
              z: 0,
              shadow: 'contact' as const,
              purpose: 'Shadow fixture',
            },
          ],
          look: { ...editor.state().document.look, sun: { azimuthDeg: -90, elevationDeg: 35 } },
          hero: { x: -1, z: 0 },
        };
      await view.apply(document);
      view.setHeroWalking(true);
      view.walkHero(1, 0, 200);
      view.render();
      const presentation = view.presentation!,
        contacts = presentation.roomPresentation.inkRoom!.contactShadows!,
        hero = presentation.actorPresentation.actors.get(view.sim!.hero.id)!,
        renderer = presentation.renderer,
        gl = renderer.getContext(),
        width = gl.drawingBufferWidth,
        height = gl.drawingBufferHeight;
      presentation.lookRenderer.setSettings({ lighting: false, depthOfField: 1 });
      const capture = () => {
        view.render();
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const opacity = hero.shadow.material.opacity;
      contacts.mesh.visible = false;
      hero.shadow.material.opacity = 0;
      const initialCast = capture();
      presentation.lookRenderer.setSettings({ shadows: false });
      const baseline = capture();
      contacts.mesh.visible = true;
      const props = capture();
      contacts.mesh.visible = false;
      hero.shadow.material.opacity = opacity;
      const actor = capture();
      hero.shadow.material.opacity = 0;
      presentation.lookRenderer.setSettings({ shadows: true });
      const cast = capture();
      presentation.lookRenderer.setSettings({ shadows: false });
      hero.shadow.material.opacity = opacity;
      contacts.mesh.visible = true;
      capture();
      hero.sprite.mesh.updateMatrixWorld(true);
      const vertices = hero.sprite.geometry.getAttribute('position');
      const projected = Array.from({ length: vertices.count }, (_, i) => {
        const p = hero.sprite.mesh.position
          .clone()
          .fromBufferAttribute(vertices, i)
          .applyMatrix4(hero.sprite.mesh.matrixWorld)
          .project(presentation.camera);
        return { x: ((p.x + 1) * width) / 2, y: ((p.y + 1) * height) / 2 };
      });
      const bounds = {
        minX: Math.min(...projected.map((p) => p.x)) - 2,
        maxX: Math.max(...projected.map((p) => p.x)) + 2,
        minY: Math.min(...projected.map((p) => p.y)) - 2,
        maxY: Math.max(...projected.map((p) => p.y)) + 2,
      };
      const darkened = (image: Uint8Array, outsideHero = false) => {
        let count = 0;
        for (let i = 0; i < baseline.length; i += 4) {
          const x = (i / 4) % width,
            y = Math.floor(i / 4 / width);
          if (
            outsideHero &&
            x >= bounds.minX &&
            x <= bounds.maxX &&
            y >= bounds.minY &&
            y <= bounds.maxY
          )
            continue;
          if (
            baseline[i]! +
              baseline[i + 1]! +
              baseline[i + 2]! -
              image[i]! -
              image[i + 1]! -
              image[i + 2]! >
            6
          )
            count++;
        }
        return count;
      };
      view.setEditingVisibility(new Set(['grounded-prop']));
      view.render();
      const hiddenOpacity = contacts.mesh.geometry.getAttribute('contactOpacity').getX(0);
      view.setEditingVisibility(new Set());
      view.render();
      const shownOpacity = contacts.mesh.geometry.getAttribute('contactOpacity').getX(0);
      return {
        props: darkened(props),
        hero: darkened(actor),
        cast: darkened(cast, true),
        initialCast: darkened(initialCast, true),
        hiddenOpacity,
        shownOpacity,
        error: gl.getError(),
      };
    }, layout);
    expect(pixels.error).toBe(0);
    expect(pixels.hiddenOpacity).toBe(0);
    expect(pixels.shownOpacity).toBeGreaterThan(0);
    expect(pixels.props).toBeGreaterThan(10);
    expect(pixels.hero).toBeGreaterThan(10);
    expect(pixels.cast).toBeGreaterThan(100);
    expect(pixels.initialCast).toBeGreaterThan(100);
  });
