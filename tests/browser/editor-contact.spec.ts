import { test, expect } from './fixtures';
import type {} from '../../src/editor/main';

test('editor renders prop and hero contact shadows with directional shadows disabled', async ({
  page,
}) => {
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  const pixels = await page.evaluate(async () => {
    const editor = window.sceneEditor,
      view = editor.view(),
      document = {
        ...structuredClone(editor.state().document),
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
        hero: { x: -1, z: 0 },
      };
    await view.apply(document);
    view.render();
    const presentation = view.presentation!,
      contacts = presentation.roomPresentation.inkRoom!.contactShadows!,
      hero = presentation.actorPresentation.actors.get(view.sim!.hero.id)!,
      renderer = presentation.renderer,
      gl = renderer.getContext(),
      width = gl.drawingBufferWidth,
      height = gl.drawingBufferHeight;
    presentation.lookRenderer.setSettings({ shadows: false, depthOfField: 0 });
    const capture = () => {
      view.render();
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const opacity = hero.shadow.material.opacity;
    contacts.mesh.visible = false;
    hero.shadow.material.opacity = 0;
    const baseline = capture();
    contacts.mesh.visible = true;
    const props = capture();
    contacts.mesh.visible = false;
    hero.shadow.material.opacity = opacity;
    const actor = capture();
    contacts.mesh.visible = true;
    capture();
    const darkened = (image: Uint8Array) => {
      let count = 0;
      for (let i = 0; i < baseline.length; i += 4)
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
      return count;
    };
    return { props: darkened(props), hero: darkened(actor), error: gl.getError() };
  });
  expect(pixels.error).toBe(0);
  expect(pixels.props).toBeGreaterThan(10);
  expect(pixels.hero).toBeGreaterThan(10);
});
