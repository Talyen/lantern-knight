import {
  parseSceneDocument,
  type SceneDocument,
  type SceneObject,
} from '../content/scene-document';
import { localOffset } from '../content/scenery-presets';
import { resolveAuthoredScene, type ArtPlacement } from '../content/world-art';
export type EditorItem = { placement: ArtPlacement; kind: SceneObject['kind']; locked: boolean };
export function sceneItems(document: SceneDocument): EditorItem[] {
  const art = resolveAuthoredScene(document),
    added = new Set(document.objects.map((p) => p.id));
  return [
    ...art.props.map((placement) => ({
      placement,
      kind: document.objects.find((p) => p.id === placement.id)?.kind ?? ('prop' as const),
      locked: !added.has(placement.id),
    })),
    ...art.decals.map((placement) => ({
      placement,
      kind: 'decal' as const,
      locked: !added.has(placement.id),
    })),
  ];
}
export class EditorHistory {
  document: SceneDocument;
  private past: SceneDocument[] = [];
  private future: SceneDocument[] = [];
  constructor(document: SceneDocument) {
    this.document = parseSceneDocument(document);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  reidentify(id: string, target: SceneDocument['target']) {
    const identify = (document: SceneDocument) => parseSceneDocument({ ...document, id, target });
    const document = identify(this.document),
      past = this.past.map(identify),
      future = this.future.map(identify);
    this.document = document;
    this.past = past;
    this.future = future;
  }
  change(mutator: (d: SceneDocument) => void) {
    const next = structuredClone(this.document);
    mutator(next);
    const valid = parseSceneDocument(next);
    resolveAuthoredScene(valid);
    if (JSON.stringify(valid) === JSON.stringify(this.document)) return;
    this.past.push(this.document);
    if (this.past.length > 100) this.past.shift();
    this.document = valid;
    this.future = [];
  }
  undo() {
    const previous = this.past.pop();
    if (previous) {
      this.future.push(this.document);
      this.document = previous;
    }
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.document);
      this.document = next;
    }
  }
  transform(
    id: string,
    fields: Partial<Pick<SceneObject, 'x' | 'z' | 'y' | 'scale' | 'mirror' | 'rotation'>>,
  ) {
    const item = sceneItems(this.document).find((p) => p.placement.id === id);
    if (!item || item.locked) throw new Error('Object is locked');
    this.change((d) => {
      const object = d.objects.find((p) => p.id === id)!;
      if (object.mount) {
        const { x, y, z, ...other } = fields;
        const offset = object.mount.offset;
        const support = sceneItems(d).find((p) => p.placement.id === object.mount!.to)!.placement;
        const delta = localOffset(support, [
          x === undefined ? 0 : x - item.placement.x,
          y === undefined ? 0 : y - (item.placement.y ?? 0),
          z === undefined ? 0 : z - item.placement.z,
        ]);
        for (let i = 0; i < 3; i++) offset[i]! += delta[i]!;
        Object.assign(object, other);
      } else Object.assign(object, fields);
    });
  }

  remove(id: string) {
    const item = sceneItems(this.document).find((p) => p.placement.id === id);
    if (!item || item.locked) throw new Error('Object is locked');
    this.change((d) => {
      const removed = new Set([id]);
      let count;
      do {
        count = removed.size;
        for (const p of d.objects) if (p.mount && removed.has(p.mount.to)) removed.add(p.id);
      } while (count !== removed.size);
      d.objects = d.objects.filter((p) => !removed.has(p.id));
    });
  }

  duplicate(id: string) {
    const item = sceneItems(this.document).find((p) => p.placement.id === id);
    if (!item || item.locked) throw new Error('Object is locked');
    const p = structuredClone(this.document.objects.find((p) => p.id === id)!),
      newId = 'object-' + crypto.randomUUID();
    delete p.footprint;
    delete p.footprintAngle;
    p.id = newId;
    if (p.fixture) p.fixture.id = newId + '-flame';
    if (p.mount) {
      const support = sceneItems(this.document).find(
        (v) => v.placement.id === p.mount!.to,
      )!.placement;
      const delta = localOffset(support, [0.5, 0, 0.5]);
      for (let i = 0; i < 3; i++) p.mount.offset[i]! += delta[i]!;
    } else {
      p.x = item.placement.x + 0.5;
      p.z = item.placement.z + 0.5;
    }
    this.change((d) => d.objects.push(p));
    return newId;
  }
}
