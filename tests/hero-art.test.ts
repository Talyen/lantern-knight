import test from 'node:test';
import assert from 'node:assert/strict';
import { heroTimings } from '../src/content/hero-actions';
import {
  selectAuthoredDirection,
  AUTHORED_HEADINGS,
  HEADINGS,
  makeCamera,
  trimmedBounds,
} from '../src/core/camera';
import { parseManifest, resolveClip } from '../src/assets/schema';
import { readAsset } from '../tools/assets/io';
import { ActorSprite } from '../src/presentation/sprite';
import { Texture, Vector3 } from 'three';
test('current hero preserves mixed native registrations and resolves all headings without mirroring', async () => {
  const m = parseManifest(
    JSON.parse(await readAsset('public/generated/ink/ink-hero-current/manifest.json', 'utf8')),
  );
  assert.equal(m.asset.status, 'proxy');
  assert.equal(m.asset.viewMode, 'mixed-directional');
  assert.throws(() => parseManifest(m, true), /production/);
  const clip = resolveClip(m, 'sweep', 'd00'),
    frames = clip.frames.map((id) => m.frames.find((f) => f.id === id)!);
  assert.equal(frames[0]!.registration!.density, 350);
  assert.equal(frames[1]!.registration!.density, 243);
  const textures = new Map(m.pages.map((p) => [p.id, new Texture()]));
  const sprite = new ActorSprite('native-hero', m, textures, clip),
    camera = makeCamera(16 / 9),
    foot = new Vector3(1, 0.2, 2);
  for (const frame of frames) {
    sprite.show(frame.id, foot, camera);
    const b = trimmedBounds(frame.registration!, frame.trim),
      pos = sprite.geometry.getAttribute('position');
    assert.ok(Math.abs(pos.getX(0) - b.left) < 1e-6);
    assert.ok(Math.abs(pos.getY(0) - b.top) < 1e-6);
    assert.deepEqual(sprite.mesh.position, foot);
  }
  for (const name of Object.keys(m.asset.clips))
    for (const heading of name === 'walk' ? HEADINGS : AUTHORED_HEADINGS) {
      const c = resolveClip(m, name, heading);
      assert.deepEqual(c.durationsMs, heroTimings[name]![heading]!.holdsMs);
      assert.ok(c.frames.every((id) => m.frames.some((f) => f.id === id)));
      assert.equal(c.loop, ['ready', 'idle', 'walk'].includes(name));
    }
  for (const heading of HEADINGS) {
    assert.ok(
      resolveClip(m, 'walk', heading).frames.every((id) => id.startsWith(`walk-${heading}-`)),
    );
    const actionHeading = selectAuthoredDirection((HEADINGS.indexOf(heading) * Math.PI) / 4);
    assert.equal(resolveClip(m, 'sweep', heading), resolveClip(m, 'sweep', actionHeading));
  }
  const missing = structuredClone(m);
  delete missing.asset.clips.walk!.d45;
  assert.throws(() => parseManifest(missing), /missing required heading/);
  sprite.dispose();
});
