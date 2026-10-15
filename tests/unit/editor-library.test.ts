import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import { SceneLibrary } from '../../src/editor/library';
import { mockGlobals } from '../fixtures/globals';

function fixture(t: Parameters<typeof mockGlobals>[0]) {
  function node() {
    return {
      hidden: false,
      textContent: '',
      value: '',
      open: false,
      children: [] as unknown[],
      dataset: {} as Record<string, string>,
      append(child: unknown) {
        this.children.push(child);
      },
      prepend() {},
      replaceChildren() {
        this.children = [];
      },
      showModal() {
        this.open = true;
      },
      remove() {},
    };
  }
  const nodes = new Map<string, ReturnType<typeof node>>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id)!;
  };
  const sections = ['scenes', 'recovery', 'arrangements'].map((library) => ({
    ...node(),
    dataset: { library },
  }));
  const requests: ((response: Response) => void)[] = [];
  const started = new Map<number, () => void>();
  mockGlobals(t, {
    document: { getElementById: get, createElement: node },
    fetch: () =>
      new Promise<Response>((resolve) => {
        const index = requests.length;
        requests.push(resolve);
        started.get(index)?.();
      }),
  });
  const library = Object.create(SceneLibrary.prototype) as SceneLibrary;
  Object.assign(library, {
    lifetime: new AbortController(),
    loadSequence: 0,
    dialog: { ...node(), querySelectorAll: () => sections },
    preview: new Group(),
    host: { recoveries: () => [], view: () => ({ render() {} }) },
  });
  const respond = (index: number, value: unknown) => {
    const reading = Promise.withResolvers<void>();
    requests[index]!({
      ok: true,
      json: () => {
        reading.resolve();
        return Promise.resolve(value);
      },
    } as Response);
    return reading.promise;
  };
  const whenRequested = (index: number) =>
    requests[index]
      ? Promise.resolve()
      : new Promise<void>((resolve) => started.set(index, resolve));
  return { library, get, sections, respond, whenRequested };
}

test('a late library listing cannot replace a more recent recovery view', async (t) => {
  const f = fixture(t);
  const first = f.library.load('scenes'),
    second = f.library.load('recovery');
  f.respond(1, { scenes: [] });
  await second;
  f.respond(0, { scenes: [] });
  await first;
  assert.equal(f.get('library-title').textContent, 'Recovery history');
  assert.equal(f.sections.find((section) => section.dataset.library === 'recovery')!.hidden, false);
});

test('a late arrangement body cannot paint after the library is disposed', async (t) => {
  const f = fixture(t);
  const loading = f.library.load('arrangements');
  const cancelled = assert.rejects(loading, { name: 'AbortError' });
  f.respond(0, { scenes: [] });
  await f.whenRequested(1);
  const body = Promise.withResolvers<unknown>();
  await f.respond(1, body.promise);
  f.library.dispose();
  body.resolve({
    fragments: [
      {
        id: 'arrangement',
        fragment: {
          version: 1,
          name: 'Lantern',
          objects: [
            { id: 'lantern', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 0, z: 0 },
          ],
        },
      },
    ],
  });
  await cancelled;
  assert.equal(f.get('library-fragments').children.length, 0);
});
