import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneDocument, resolveSceneDocument } from '../../src/content/scene-document';
import { sceneCompositionFindings } from '../../src/content/scene-design';
import { churchyardColliders } from '../../src/content/world-art';
import { sceneArtFindings } from '../../src/content/scene-art-validation';
import { sceneFixture } from '../fixtures/scene';
import { EditorHistory } from '../../src/editor/model';
test('prototype artwork treatment and palette are advice; footprints may be explicitly authored', () => {
  const d = sceneFixture('graveyard'),
    p = d.objects[0]!;
  p.scale = 2;
  p.mirror = true;
  p.tint = 0x999999;
  p.y = 0.5;
  p.footprint = [1.2, 0.7];
  const art = resolveSceneDocument(parseSceneDocument(d));
  assert.deepEqual(art.props[0]!.footprint, [1.2, 0.7]);
  const findings = sceneCompositionFindings(art);
  assert.ok(
    findings.some((note) => note.includes('experimental artwork treatment')),
    'scaled, mirrored and tinted treatment is flagged as experimental advice, not rejected: ' +
      findings.join('; '),
  );
  const history = EditorHistory.create(d);
  history.transform(p.id, { scale: 3 });
  assert.equal(history.document.objects[0]!.scale, 3);
  history.undo();
  assert.equal(history.document.objects[0]!.scale, 2);
});
test('a mounted object owns no ground footprint, collider or solid', () => {
  const d = sceneFixture('chapel'),
    mounted = d.objects.find((o) => o.id === 'crypt-altar-candles')!;
  // A palette entry with a ground footprint, hung from the altar.
  mounted.asset = 'ink-scenery';
  mounted.clip = 'gravestone';
  const art = resolveSceneDocument(parseSceneDocument(d)),
    placement = art.props.find((p) => p.id === 'crypt-altar-candles')!;
  assert.equal(placement.role, 'attachment');
  assert.equal(
    placement.footprint,
    undefined,
    'a mounted object hangs from its support and owns no ground footprint',
  );
  assert.ok(
    !churchyardColliders(art).some((c) => c.id === 'crypt-altar-candles'),
    'a mounted object must not block the ground beneath its support',
  );
  assert.ok(
    !sceneArtFindings(art).some(
      (finding) =>
        finding.kind === 'solid-intersection' &&
        (finding.a === 'crypt-altar-candles' || finding.b === 'crypt-altar-candles'),
    ),
    'a mounted object is not a ground solid that can overlap its support',
  );
});
test('current documents reject malformed values and attachment cycles while allowing socket experiments', () => {
  const d = sceneFixture('chapel'),
    lamp = d.objects.find((p) => p.mount)!;
  lamp.mount!.offset[0] += 0.25;
  assert.doesNotThrow(() => resolveSceneDocument(parseSceneDocument(d)));
  assert.throws(() =>
    parseSceneDocument({
      ...d,
      camera: { ...d.camera, bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 1 } },
    }),
  );
  const parent = d.objects.find((p) => p.id === lamp.mount!.to)!;
  delete parent.x;
  delete parent.z;
  parent.role = 'attachment';
  parent.mount = { to: lamp.id, offset: [0, 0, 0] };
  assert.throws(() => resolveSceneDocument(parseSceneDocument(d)), /Cyclic/);
});
