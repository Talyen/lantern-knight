import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contactSupport,
  smoothContacts,
  contactIdentity,
} from '../../tools/assets/contact-support';
import { manifestFixture } from '../fixtures/manifest';

test('automatic support extraction finds separated soles and rejects off-root weapons and empty frames', () => {
  const m = manifestFixture('unseen-kit'),
    f = m.frames[0]!;
  m.asset.type = 'character';
  m.asset.shadow.radius = 0.34;
  f.registration = { canvas: [128, 128], anchor: [64, 100], density: 100 };
  f.trim = [0, 0, 128, 128];
  f.rect = [0, 0, 128, 128];
  const pixels = new Uint8Array(128 * 128 * 4);
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) pixels[(y * 128 + x) * 4 + 3] = 255;
  };
  assert.deepEqual(contactSupport(pixels, 128, f, m.asset), []);
  box(38, 90, 51, 104);
  box(75, 86, 90, 97);
  box(124, 60, 127, 127);
  const contacts = contactSupport(pixels, 128, f, m.asset);
  assert.equal(contacts.length, 2);
  assert.ok(contacts[0]![0] < 0 && contacts[1]![0] > 0);
  assert.ok(Math.abs(contacts[0]![1] + 0.04) < 0.001);
  assert.ok(Math.abs(contacts[1]![1] - 0.03) < 0.001);
});

test('prepared support coordinates preserve registration across atlas trimming and suppress small temporal noise', () => {
  const m = manifestFixture('unseen-prop'),
    f = m.frames[0]!;
  m.asset.type = 'prop';
  f.registration = { canvas: [100, 100], anchor: [50, 80], density: 100 };
  f.trim = [20, 50, 60, 40];
  f.rect = [8, 4, 60, 40];
  const pixels = new Uint8Array(80 * 48 * 4);
  for (let y = 10; y <= 34; y++) for (let x = 18; x <= 57; x++) pixels[(y * 80 + x) * 4 + 3] = 255;
  const patches = contactSupport(pixels, 80, f, m.asset);
  assert.ok(patches.length > 0);
  assert.ok(patches.every((p) => p.every(Number.isFinite)));
  assert.ok(patches.every((p) => Math.abs(p[1]) < 0.02));
  m.frames = [0, 0.02, 0].map((y, i) => ({ ...f, id: 'pose-' + i, contact: [[0, y, 0.1, 0.03]] }));
  m.asset.clips = {
    idle: { d45: { ...m.asset.clips.idle!.d45!, frames: m.frames.map((f) => f.id) } },
  };
  smoothContacts(m);
  assert.equal(m.frames[1]!.contact![0]![1], 0);
});

test('support reuse identity ignores derived contacts and changes with pixels, registration or clip neighbors', () => {
  const manifest = manifestFixture();
  manifest.frames.push({ ...manifest.frames[0]!, id: 'next-frame', source: 'next.png' });
  manifest.asset.clips.idle!.d45!.frames.push('next-frame');
  manifest.asset.clips.idle!.d45!.durationsMs.push(200);
  const identity = contactIdentity(manifest);
  manifest.frames[0]!.contact = [[0, 0, 0.1, 0.03]];
  assert.equal(contactIdentity(manifest), identity);
  manifest.frames[0]!.registration = {
    canvas: manifest.asset.canvas,
    anchor: manifest.asset.anchor,
    density: manifest.asset.density * 2,
  };
  assert.notEqual(contactIdentity(manifest), identity);
  delete manifest.frames[0]!.registration;
  assert.equal(contactIdentity(manifest), identity);
  manifest.pages[0]!.hash = 'e'.repeat(64);
  assert.notEqual(contactIdentity(manifest), identity);
  manifest.pages[0]!.hash = 'b'.repeat(64);
  assert.equal(contactIdentity(manifest), identity);
  manifest.asset.clips.idle!.d45!.frames.reverse();
  assert.notEqual(contactIdentity(manifest), identity);
});
