import { readAsset } from '../tools/assets/io';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assetCatalog } from '../src/content/visuals';
import {
  normalPixels,
  cameraKeyDirection,
  defaultLook,
  lightingRigs,
} from '../src/presentation/lighting-profiles';
import { right, up, outward, contract } from '../src/core/camera';
import { Vector3 } from 'three';
import { GroundMist } from '../src/presentation/ground-mist';
import { content, heightAt } from '../src/content/world';
test('chosen lights face the fixed camera from the upper left and shorten cast shadows', () => {
  for (const rig of Object.values(lightingRigs)) {
    const d = new Vector3().fromArray(
      cameraKeyDirection(contract.azimuthDeg, rig.elevation, rig.side),
    );
    assert.ok(Math.abs(d.length() - 1) < 1e-10);
    assert.ok(d.dot(right) < -0.2);
    assert.ok(d.dot(up) > 0.1);
    assert.ok(d.dot(outward) > 0.7);
    assert.ok(1 / Math.tan((rig.elevation * Math.PI) / 180) < 1.2);
  }
  assert.equal(defaultLook.look, 'diorama');
  assert.equal(defaultLook.strength, 1.5);
});
test('mist ribbons follow the raised terrain rather than intersecting its steps', () => {
  const mist = new GroundMist(),
    area = content.area('upper-landing');
  mist.setArea(area);
  for (const object of mist.group.children) {
    const mesh = object as import('three').Mesh,
      vertices = mesh.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++)
      assert.ok(
        Math.abs(
          vertices.getY(i) -
            heightAt(area, mesh.position.x + vertices.getX(i), mesh.position.z + vertices.getZ(i)) -
            0.14,
        ) < 1e-6,
      );
  }
  mist.dispose();
  assert.equal(mist.group.parent, null);
});
test('alpha-derived normals point outward with an unchanged coverage channel', () => {
  const alpha = new Uint8Array([
      0, 0, 0, 0, 0, 0, 40, 100, 40, 0, 0, 100, 255, 100, 0, 0, 40, 100, 40, 0, 0, 0, 0, 0, 0,
    ]),
    normals = normalPixels(alpha, 5, 5, 2);
  const pixel = (x: number, y: number) => normals.slice((y * 5 + x) * 4, (y * 5 + x) * 4 + 4);
  assert.ok(pixel(1, 2)[0]! < 128);
  assert.ok(pixel(3, 2)[0]! > 128);
  assert.ok(pixel(2, 1)[1]! > 128);
  assert.ok(pixel(2, 3)[1]! < 128);
  assert.deepEqual([...pixel(2, 2)], [128, 128, 255, 255]);
  for (let i = 0; i < alpha.length; i++) assert.equal(normals[i * 4 + 3], alpha[i]);
  assert.throws(() => normalPixels(alpha, 4, 5), /dimensions/);
});
test('every lighting companion is bound to the unchanged source page and registered frame', async () => {
  const library = JSON.parse(await readAsset('public/lighting/manifest.json', 'utf8'));
  assert.equal(library.recipe, 'alpha-volume-v1');
  let count = 0;
  for (const asset of [
    'ink-hero-current',
    'ink-skeleton',
    'ink-scenery',
    'ink-graveyard-scenery',
    'ink-blackwood-oak',
    'ink-blackwood-woodland',
    ...Object.keys(assetCatalog).filter((id) => id.startsWith('ink-tended-')),
  ]) {
    const manifest = JSON.parse(await readAsset(path.join('public', assetCatalog[asset]!), 'utf8'));
    for (const frame of manifest.frames) {
      const entry = library.entries[`${asset}:${frame.id}`];
      assert.ok(entry);
      assert.equal(
        entry.sourceHash,
        manifest.pages.find((p: { id: string }) => p.id === frame.page).hash,
      );
      assert.deepEqual(entry.rect, frame.rect);
      assert.deepEqual(entry.trim, frame.trim);
      const bytes = await readAsset(path.join('public/lighting', entry.file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.hash);
      count++;
    }
  }
  assert.equal(Object.keys(library.entries).length, count);
});
