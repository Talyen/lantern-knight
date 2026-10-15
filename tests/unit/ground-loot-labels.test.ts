import test from 'node:test';
import assert from 'node:assert/strict';
import { mockGlobals } from '../fixtures/globals';
import { content } from '../fixtures/content';
import { Simulation } from '../../src/core/simulation';
import { GroundLootLabels } from '../../src/ground-loot-labels';
import { makeCamera } from '../../src/presentation/camera';
import type { Application } from '../../src/application';

function fixture(t: Parameters<typeof mockGlobals>[0], count: number) {
  const buttons: ReturnType<typeof button>[] = [];
  function button() {
    return Object.assign(new EventTarget(), {
      type: '',
      className: '',
      dataset: {} as Record<string, string>,
      textContent: '',
      hidden: false,
      offsetWidth: 100,
      style: { left: '', top: '' },
      setAttribute() {},
      remove() {},
    });
  }
  mockGlobals(t, { document: { createElement: button } });
  const sim = new Simulation(content);
  sim.drops = Array.from({ length: count }, (_, i) => ({
    id: 'drop-' + i,
    source: 'crate',
    enemy: false,
    x: 0,
    z: 0,
    rewards: [{ item: 'gold', amount: 1 }],
  }));
  const app = {
    sim: sim.view,
    presentation: { camera: makeCamera(6.4) },
    highlightedDrop: undefined as string | undefined,
  };
  const root = {
    hidden: false,
    clientWidth: 640,
    clientHeight: 100,
    append: (b: ReturnType<typeof button>) => {
      buttons.push(b);
    },
  };
  const lifetime = new AbortController();
  const labels = new GroundLootLabels(
    root as unknown as HTMLElement,
    app as unknown as Application,
    lifetime.signal,
  );
  labels.update(true);
  return { labels, app, buttons };
}

test('leaving keyboard focus clears the old loot interaction priority', (t) => {
  const { app, buttons } = fixture(t, 1);
  buttons[0]!.dispatchEvent(new Event('focus'));
  assert.equal(app.highlightedDrop, 'drop-0');
  buttons[0]!.dispatchEvent(new Event('blur'));
  assert.equal(app.highlightedDrop, undefined);
});

test('crowded loot labels use available columns without falling outside the viewport', (t) => {
  const { buttons } = fixture(t, 8);
  const positions = buttons.map((b) => ({
    x: parseFloat(b.style.left),
    y: parseFloat(b.style.top),
  }));
  for (const p of positions) {
    assert.ok(p.x >= 50 && p.x <= 590);
    assert.ok(p.y >= 12 && p.y <= 88, `label at ${p.y} is clipped`);
  }
  for (const [i, p] of positions.entries())
    for (const q of positions.slice(i + 1))
      assert.ok(Math.abs(p.x - q.x) >= 106 || Math.abs(p.y - q.y) >= 25);
});
