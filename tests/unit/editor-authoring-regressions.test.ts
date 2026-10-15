import { interactable } from '../fixtures/world';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Group, Line } from 'three';
import { mockGlobals } from '../fixtures/globals';
import { content, contentDefinitions } from '../fixtures/content';
import { emptyScene } from '../../src/editor/default-scene';
import { EditorHistory, sceneItems } from '../../src/editor/model';
import { VisualAuthoring } from '../../src/editor/visual-authoring';
import { CompositionTools } from '../../src/editor/composition';
import { EditorView } from '../../src/editor/view';
import { Simulation } from '../../src/core/simulation';
import { composeDraftGameplay } from '../../src/content/draft-gameplay';
import type { SceneDocument } from '../../src/content/scene-document';
import type { AssetRuntime } from '../../src/assets/loader';

class Node {
  children: Node[] = [];
  dataset: Record<string, string> = {};
  textContent = '';
  value = '';
  type = '';
  checked = false;
  onchange?: () => void;
  onclick?: () => void;
  constructor(readonly tag = '') {}
  append(...nodes: Node[]) {
    this.children.push(...nodes);
  }
  add(node: Node) {
    this.append(node);
  }
  setAttribute(name: string, value: string) {
    this.dataset[name] = value;
  }
  querySelector(selector: string): Node | undefined {
    return this.all().find((node) => node.tag === selector);
  }
  all(): Node[] {
    return this.children.flatMap((node) => [node, ...node.all()]);
  }
}
class InputNode extends Node {}
class SelectNode extends Node {}

function fixture(t: Parameters<typeof mockGlobals>[0], configure?: (d: SceneDocument) => void) {
  const d = emptyScene();
  d.objects = [
    { id: 'supplies', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 1, z: 1 },
    { id: 'other', kind: 'prop', asset: 'ink-scenery', clip: 'urn-niche', x: 4, z: 0 },
  ];
  configure?.(d);
  const history = new EditorHistory(d);
  const nodes = new Map<string, Node>();
  const root = new Node();
  mockGlobals(t, {
    HTMLInputElement: InputNode,
    HTMLSelectElement: SelectNode,
    Option: class extends Node {
      constructor(label: string, value: string) {
        super('option');
        this.textContent = label;
        this.value = value;
      }
    },
    document: {
      createElement: (tag: string) =>
        tag === 'input'
          ? new InputNode(tag)
          : tag === 'select'
            ? new SelectNode(tag)
            : new Node(tag),
      getElementById: (id: string) => {
        if (!nodes.has(id)) nodes.set(id, new Node());
        return nodes.get(id)!;
      },
    },
  });
  const errors: unknown[] = [];
  const tools = Object.create(VisualAuthoring.prototype) as VisualAuthoring;
  Object.assign(tools, {
    objectFields: root,
    host: {
      history: () => history,
      selected: () => 'supplies',
      change: (mutate: (draft: SceneDocument) => void) => {
        try {
          history.change((draft) => {
            mutate(draft);
            composeDraftGameplay(draft, contentDefinitions, {});
          });
        } catch (error) {
          errors.push(error);
        }
        return Promise.resolve();
      },
    },
  });
  const api = tools as unknown as {
    form(value: unknown, path: (string | number)[], parent: Node, label: string): void;
    commit(path: (string | number)[], value: unknown): void;
    objectForm(object: SceneDocument['objects'][number], index: number): void;
  };
  function add(path: (string | number)[], value: unknown, label: string) {
    api.form(value, path, root, label);
    const button = root.all().find((n) => n.tag === 'button' && n.textContent === 'Add ' + label)!;
    assert.ok(button, 'add control exists');
    button.onclick!();
  }
  return { history, tools, api, root, add, errors };
}

for (const kind of ['pickups', 'interactables'] as const)
  test(`editing ${kind} coordinates moves linked artwork and the playable target`, (t) => {
    const f = fixture(t, (d) => {
      if (kind === 'pickups')
        d.gameplay!.pickups = [
          {
            id: 'health',
            object: 'supplies',
            kind: 'health',
            x: -2,
            z: -2,
            amount: 25,
            radius: 0.5,
          },
        ];
      else
        d.gameplay!.interactables = [
          interactable({
            id: 'chest',
            object: 'supplies',
            x: -2,
            z: -2,
            idle: 'lantern',
            action: 'lantern',
            spent: 'lantern',
          }),
        ];
    });
    f.api.form(f.history.document.gameplay![kind]![0], ['gameplay', kind, 0], f.root, kind);
    assert.equal(
      f.root.all().find((node) => node.dataset.field === `gameplay.${kind}.0.z`)!.value,
      '1',
    );
    f.api.commit(['gameplay', kind, 0, 'x'], 3);
    const result = composeDraftGameplay(f.history.document, contentDefinitions, {});
    assert.equal(result.registry.area('editor-flat')[kind]![0]!.x, 3);
    assert.equal(sceneItems(f.history.document)[0]!.placement.x, 3);
    f.history.undo();
    assert.equal(sceneItems(f.history.document)[0]!.placement.x, 1);
  });

test('adding an empty guard list selects an existing enemy identity', (t) => {
  const f = fixture(t, (d) => {
    d.gameplay!.spawns = [{ id: 'warden', actor: 'skeleton', x: -3, z: -3 }];
    d.gameplay!.interactables = [
      interactable({
        id: 'chest',
        object: 'supplies',
        x: 1,
        z: 1,
        idle: 'lantern',
        action: 'lantern',
        spent: 'lantern',
      }),
    ];
  });
  f.add(['gameplay', 'interactables', 0, 'guards'], [], 'Guards');
  assert.deepEqual(f.history.document.gameplay!.interactables![0]!.guards, ['warden']);
});

test('adding draw-order entries advances through the remaining artwork', (t) => {
  const f = fixture(t, (d) => {
    d.propOrder = ['supplies'];
  });
  f.add(['propOrder'], ['supplies'], 'Draw order');
  assert.deepEqual(f.history.document.propOrder, ['supplies', 'other']);
});

test('new interactables start with animations that exist on their selected artwork', (t) => {
  const f = fixture(t);
  f.add(['gameplay', 'interactables'], [], 'Interactables');
  const object = f.history.document.gameplay!.interactables![0]!;
  assert.deepEqual([object.idle, object.action, object.spent], ['lantern', 'lantern', 'lantern']);
});

test('choosing a custom attachment offset clears the named socket without moving the attachment', (t) => {
  const f = fixture(t, (d) => {
    d.hero = { x: -3, z: -3 };
    d.objects[0] = {
      id: 'support',
      kind: 'prop',
      asset: 'ink-scenery',
      clip: 'offering-table',
      x: 0,
      z: 0,
    };
    d.objects[1] = {
      id: 'supplies',
      kind: 'prop',
      asset: 'ink-crypt',
      clip: 'votive-hardware',
      role: 'attachment',
      mount: { to: 'support', socket: 'votive', offset: [-0.07, 0.8, 0.08] },
    };
  });
  f.api.objectForm(
    structuredClone(f.history.document.objects[1]!) as SceneDocument['objects'][number],
    1,
  );
  const select = f.root.all().find((n) => n.dataset['aria-label'] === 'Attachment socket')!;
  select.value = '';
  select.onchange!();
  assert.deepEqual(f.errors.map(String), []);
  assert.equal(f.history.document.objects[1]!.mount!.socket, undefined);
  assert.deepEqual(f.history.document.objects[1]!.mount!.offset, [-0.07, 0.8, 0.08]);
});

test('editor walking preserves the preceding position so locomotion animation can advance', () => {
  const view = new EditorView({} as HTMLCanvasElement, {} as AssetRuntime);
  const sim = new Simulation(content);
  const renderer = { center: new Vector3() };
  Object.assign(view, {
    accepted: true,
    simulation: sim,
    renderer,
    render() {},
    appliedDocument: emptyScene(),
  });
  view.setHeroWalking(true);
  const before = { x: sim.hero.x, z: sim.hero.z };
  view.walkHero(1, 0, 16);
  assert.ok(Math.hypot(sim.hero.x - sim.hero.px, sim.hero.z - sim.hero.pz) > 0);
  assert.equal(sim.hero.px, before.x);
  assert.equal(sim.hero.pz, before.z);
});

test('focus selection follows its rendered elevation', () => {
  const h = new EditorHistory({
    ...emptyScene(),
    objects: [
      { id: 'lamp', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 1, y: 3, z: 1 },
    ],
  });
  const definitions = structuredClone(contentDefinitions);
  definitions.areas[0]!.surface = { kind: 'flat', height: 5 };
  const center = new Vector3();
  const tools = Object.create(CompositionTools.prototype) as CompositionTools;
  Object.assign(tools, {
    selection: new Set(['lamp']),
    host: {
      history: () => h,
      view: () => ({
        sim: { areaDefinition: definitions.areas[0] },
        presentation: { center },
        render() {},
      }),
    },
  });
  tools.focus();
  assert.equal(center.y, 9.8);
});

test('movement preview stays in its room when walking onto an automatic exit', () => {
  const sim = new Simulation(content);
  sim.movementPreview = true;
  sim.enemies.forEach((enemy) => {
    enemy.health = 0;
  });
  sim.cleared = true;
  Object.assign(sim.hero, { x: 0, z: -5.9 });
  assert.equal(sim.step().transition, undefined);
  sim.movementPreview = false;
  assert.equal(sim.step().transition, 'landing');
});

test('collision overlays show the rotated footprint used by movement', (t) => {
  const d = emptyScene();
  d.objects = [
    {
      id: 'wall',
      kind: 'prop',
      asset: 'ink-scenery',
      clip: 'lantern',
      x: 3,
      z: 3,
      footprint: [4, 1],
      footprintAngle: Math.PI / 2,
    },
  ];
  const history = new EditorHistory(d);
  const group = new Group();
  const tool = { value: 'select' };
  mockGlobals(t, {
    document: {
      getElementById: () => tool,
      querySelectorAll: () => [{ dataset: { overlay: 'collision' } }],
    },
  });
  const tools = Object.create(VisualAuthoring.prototype) as VisualAuthoring;
  Object.assign(tools, {
    group,
    handles: [],
    key: '',
    host: {
      history: () => history,
      view: () => ({
        presentation: { overlay: new Group() },
        sim: new Simulation(content),
        render() {},
      }),
    },
  });
  tools.draw();
  const points = (group.children[0] as Line).geometry.getAttribute('position');
  const xs = Array.from({ length: points.count }, (_, i) => points.getX(i));
  const zs = Array.from({ length: points.count }, (_, i) => points.getZ(i));
  assert.equal(Math.max(...xs) - Math.min(...xs), 1);
  assert.equal(Math.max(...zs) - Math.min(...zs), 4);
  tools.dispose();
});
