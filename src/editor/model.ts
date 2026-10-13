import {
  parseSceneDocument,
  type SceneDocument,
  type SceneSnapshot,
  type SceneObject,
} from '../content/scene-document';
import { contentSnapshot } from '../content/snapshot';
import { localOffset } from '../content/scenery-presets';
import { resolveAuthoredScene } from '../content/world-art';
import { type ArtPlacement } from '../content/world-visuals';
export type EditorItem = { placement: ArtPlacement; kind: SceneObject['kind'] };
export function sceneItems(document: SceneSnapshot): EditorItem[] {
  const art = resolveAuthoredScene({ ...document, groundInteraction: undefined }),
    kinds = new Map(document.objects.map((p) => [p.id, p.kind]));
  return [
    ...art.props.map((placement) => ({
      placement,
      kind: kinds.get(placement.id)!,
    })),
    ...art.decals.map((placement) => ({
      placement,
      kind: 'decal' as const,
    })),
  ];
}
export class EditorHistory {
  private current: SceneSnapshot;
  private past: SceneSnapshot[] = [];
  private future: SceneSnapshot[] = [];
  constructor(document: SceneSnapshot) {
    this.current = contentSnapshot(parseSceneDocument(document));
  }
  get document(): SceneSnapshot {
    return this.current;
  }
  fork() {
    const copy = new EditorHistory(this.document);
    copy.past = [...this.past];
    copy.future = [...this.future];
    return copy;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  reidentify(id: string, target: SceneDocument['target']) {
    const identify = (document: SceneSnapshot) =>
      contentSnapshot(parseSceneDocument({ ...document, id, target }));
    const document = identify(this.document),
      past = this.past.map(identify),
      future = this.future.map(identify);
    this.current = document;
    this.past = past;
    this.future = future;
  }
  change(mutator: (d: SceneDocument) => void) {
    const next = parseSceneDocument(this.document);
    mutator(next);
    const valid = parseSceneDocument(next);
    resolveAuthoredScene(valid);
    if (JSON.stringify(valid) === JSON.stringify(this.document)) return;
    this.past.push(this.document);
    if (this.past.length > 100) this.past.shift();
    this.current = contentSnapshot(valid);
    this.future = [];
  }
  undo() {
    const previous = this.past.pop();
    if (previous) {
      this.future.push(this.document);
      this.current = previous;
    }
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.document);
      this.current = next;
    }
  }
  transform(
    id: string,
    fields: Partial<Pick<SceneObject, 'x' | 'z' | 'y' | 'scale' | 'mirror' | 'rotation'>>,
  ) {
    const item = sceneItems(this.document).find((p) => p.placement.id === id);
    if (!item) throw new Error('Unknown scene object: ' + id);
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

  descendants(ids: readonly string[]) {
    const included = new Set(ids);
    let count;
    do {
      count = included.size;
      for (const object of this.document.objects)
        if (object.mount && included.has(object.mount.to)) included.add(object.id);
    } while (count !== included.size);
    return [...included];
  }

  transformMany(
    ids: readonly string[],
    fields: { x?: number; z?: number; rotation?: number; scale?: number },
  ) {
    let items = sceneItems(this.document).filter((p) => ids.includes(p.placement.id));
    if (!items.length) return;
    const cx = items.reduce((v, p) => v + p.placement.x, 0) / items.length;
    const cz = items.reduce((v, p) => v + p.placement.z, 0) / items.length;
    const angle = fields.rotation ?? 0,
      factor = fields.scale ?? 1;
    if (angle || factor !== 1) {
      const included = new Set(this.descendants(ids));
      items = sceneItems(this.document).filter((p) => included.has(p.placement.id));
    }
    // Resolve targets against the original snapshot. A selected support carries its
    // descendants; explicitly selected children are transformed only once.
    const targets = new Map(
      items.map(({ placement: p }) => {
        const dx = (p.x - cx) * factor,
          dz = (p.z - cz) * factor;
        return [
          p.id,
          {
            x: cx + dx * Math.cos(angle) - dz * Math.sin(angle) + (fields.x ?? 0),
            z: cz + dx * Math.sin(angle) + dz * Math.cos(angle) + (fields.z ?? 0),
            scale: (p.scale ?? 1) * factor,
            rotation: Math.atan2(
              Math.sin((p.rotation ?? 0) + angle),
              Math.cos((p.rotation ?? 0) + angle),
            ),
          },
        ];
      }),
    );
    this.change((d) => {
      for (const { placement } of items) {
        const object = d.objects.find((p) => p.id === placement.id)!;
        const target = targets.get(object.id)!;
        if (!object.mount) Object.assign(object, target);
      }
      const mounted = items.filter((p) => d.objects.find((v) => v.id === p.placement.id)?.mount);
      const depth = (id: string): number => {
        const p = d.objects.find((p) => p.id === id);
        return p?.mount ? 1 + depth(p.mount.to) : 0;
      };
      mounted.sort((a, b) => depth(a.placement.id) - depth(b.placement.id));
      for (const { placement } of mounted) {
        const object = d.objects.find((p) => p.id === placement.id)!;
        const target = targets.get(object.id)!;
        const support = sceneItems(d).find((p) => p.placement.id === object.mount!.to)!.placement;
        const offset = localOffset(support, [target.x - support.x, 0, target.z - support.z]);
        // Keep vertical attachment offsets local so scaled supports carry their children.
        object.mount!.offset = [offset[0], object.mount!.offset[1], offset[2]];
        object.scale = target.scale;
        object.rotation = target.rotation;
      }
    });
  }

  removeMany(ids: readonly string[]) {
    const removed = new Set(this.descendants(ids));
    this.change((d) => {
      d.objects = d.objects.filter((p) => !removed.has(p.id));
      if (d.gameplay) d.gameplay.pickups = d.gameplay.pickups.filter((p) => !removed.has(p.object));
      if (d.gameplay?.interactables)
        d.gameplay.interactables = d.gameplay.interactables.filter((p) => !removed.has(p.object));
      d.propOrder = d.propOrder.filter((id) => !removed.has(id));
      d.overlaps = d.overlaps.filter((p) => !removed.has(p.a) && !removed.has(p.b));
    });
  }

  duplicateMany(ids: readonly string[]) {
    const included = new Set(this.descendants(ids));
    const document = parseSceneDocument(this.document);
    const objects = sceneItems(this.document)
      .filter((p) => included.has(p.placement.id))
      .map((p) => document.objects.find((object) => object.id === p.placement.id)!);
    return this.insertFragment(objects, 0.5, 0.5, true);
  }

  fragment(ids: readonly string[]) {
    const included = new Set(this.descendants(ids));
    const items = sceneItems(this.document);
    const objects = parseSceneDocument(this.document).objects;
    return items
      .filter((p) => included.has(p.placement.id))
      .map((p) => objects.find((object) => object.id === p.placement.id)!)
      .map((p) => {
        const copy = p;
        if (copy.mount && !included.has(copy.mount.to)) {
          const world = items.find((v) => v.placement.id === p.id)!.placement;
          delete copy.mount;
          copy.role = 'upright';
          copy.x = world.x;
          copy.z = world.z;
          copy.y = world.y;
        }
        return copy;
      });
  }

  insertFragment(objects: readonly SceneObject[], dx = 0, dz = 0, copyGameplay = false) {
    const copies = structuredClone([...objects]);
    const source = parseSceneDocument(this.document);
    const remap = new Map(copies.map((p) => [p.id, 'object-' + crypto.randomUUID()]));
    this.change((d) => {
      for (const p of copies) {
        p.id = remap.get(p.id)!;
        if (p.fixture) p.fixture.id = p.id + '-flame';
        if (p.mount && remap.has(p.mount.to)) p.mount.to = remap.get(p.mount.to)!;
        else if (p.mount) {
          const support = sceneItems(d).find((v) => v.placement.id === p.mount!.to)?.placement;
          if (!support) throw new Error('Fragment attachment support is missing');
          const delta = localOffset(support, [dx, 0, dz]);
          for (let i = 0; i < 3; i++) p.mount.offset[i]! += delta[i]!;
        } else {
          p.x = p.x! + dx;
          p.z = p.z! + dz;
        }
        d.objects.push(p);
        const original = objects.find((o) => remap.get(o.id) === p.id)!;
        const pickups = copyGameplay
          ? (this.document.gameplay?.pickups.filter((v) => v.object === original.id) ?? [])
          : [];
        for (const pickup of pickups)
          if (d.gameplay)
            d.gameplay.pickups.push({
              ...structuredClone(pickup),
              id: 'pickup-' + crypto.randomUUID(),
              object: p.id,
              x: p.x ?? pickup.x,
              z: p.z ?? pickup.z,
            });
        if (copyGameplay && d.gameplay) {
          const interactables =
            source.gameplay?.interactables?.filter((v) => v.object === original.id) ?? [];
          for (const interactable of interactables) {
            d.gameplay.interactables ??= [];
            d.gameplay.interactables.push({
              ...structuredClone(interactable),
              id: 'interactable-' + crypto.randomUUID(),
              object: p.id,
              x: p.x ?? interactable.x,
              z: p.z ?? interactable.z,
            });
          }
        }
      }
    });
    return copies.map((p) => p.id);
  }
}
