import {
  parseSceneDocument,
  resolveSceneDocument,
  type SceneDocument,
  type SceneSnapshot,
  type SceneObject,
} from '../content/scene-document';
import { boundsCorners, polygonBounds } from '../content/polygon';
import { contentSnapshot, type ContentSnapshot } from '../content/snapshot';
import { localOffset } from '../content/scenery-presets';
import { resolveAuthoredScene } from '../content/world-art';
import { type ArtPlacement } from '../content/world-visuals';
export type EditorItem = { placement: ArtPlacement; kind: SceneObject['kind'] };
const itemCache = new WeakMap<SceneSnapshot, EditorItem[]>();
export function sceneItems(document: SceneSnapshot): EditorItem[] {
  const cached = itemCache.get(document);
  if (cached) return structuredClone(cached);
  // Selection needs detached placements, not a second admission of the entire scene.
  const art = resolveSceneDocument({
      ...document,
      objects: structuredClone(document.objects),
    } as SceneDocument),
    kinds = new Map(document.objects.map((p) => [p.id, p.kind]));
  // Generated gameplay visuals are edited through Gameplay, not object transforms.
  const items = [...art.props, ...art.decals]
    .filter((p) => kinds.has(p.id))
    .map((placement) => ({
      placement,
      kind: kinds.get(placement.id)!,
    }));
  // History snapshots are immutable; mutable authoring drafts must resolve afresh.
  if (Object.isFrozen(document)) itemCache.set(document, structuredClone(items));
  return items;
}
export class EditorHistory {
  private constructor(
    private current: SceneSnapshot,
    private past: SceneSnapshot[] = [],
    private future: SceneSnapshot[] = [],
  ) {}
  static create(document: SceneSnapshot) {
    const valid = parseSceneDocument(document);
    resolveAuthoredScene(valid);
    return new EditorHistory(contentSnapshot(valid));
  }
  get document(): SceneSnapshot {
    return this.current;
  }
  fork() {
    // Documents are immutable; only the undo/redo stacks belong to this editor.
    return new EditorHistory(this.document, [...this.past], [...this.future]);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  reidentify(id: string, target: SceneDocument['target']) {
    const identify = (document: SceneSnapshot) =>
      document.id === id && document.target === target
        ? document
        : contentSnapshot(parseSceneDocument({ ...document, id, target }));
    const document = identify(this.document),
      past = this.past.map(identify),
      future = this.future.map(identify);
    this.current = document;
    this.past = past;
    this.future = future;
  }
  change(mutator: (d: SceneDocument) => void) {
    const next = structuredClone(this.document) as SceneDocument;
    mutator(next);
    const valid = parseSceneDocument(next);
    if (JSON.stringify(valid) === JSON.stringify(this.document)) return;
    resolveAuthoredScene(valid);
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
    this.transformEach([id], fields);
  }

  descendants(ids: readonly string[]) {
    const included = new Set(ids);
    const children = new Map<string, string[]>();
    for (const object of this.document.objects)
      if (object.mount) {
        const siblings = children.get(object.mount.to) ?? [];
        siblings.push(object.id);
        children.set(object.mount.to, siblings);
      }
    for (const id of included) for (const child of children.get(id) ?? []) included.add(child);
    return [...included];
  }

  transformEach(ids: readonly string[], fields: Parameters<EditorHistory['transform']>[1]) {
    this.applyTransforms(new Map(ids.map((id) => [id, fields])));
  }

  private applyTransforms(
    targets: ReadonlyMap<string, Parameters<EditorHistory['transform']>[1]>,
    after?: (document: SceneDocument) => void,
  ) {
    if (!targets.size) return;
    const objects = new Map(this.document.objects.map((object) => [object.id, object])),
      depth = (id: string): number => {
        const object = objects.get(id);
        return object?.mount ? 1 + depth(object.mount.to) : 0;
      };
    this.change((document) => {
      // Supports move before attachments; the complete batch owns one undo entry.
      for (const id of [...targets.keys()].sort((a, b) => depth(a) - depth(b))) {
        const fields = targets.get(id)!;
        const object = document.objects.find((p) => p.id === id);
        if (!object) throw new Error('Unknown scene object: ' + id);
        if (object.mount) {
          // Resolve relative offsets during the batch; validate the completed scene in change().
          const art = resolveSceneDocument(document);
          const placements = [...art.props, ...art.decals];
          const item = placements.find((p) => p.id === id)!;
          const support = placements.find((p) => p.id === object.mount!.to)!;
          const { x, y, z, ...other } = fields;
          const offset = object.mount.offset;
          const delta = localOffset(support, [
            x === undefined ? 0 : x - item.x,
            y === undefined ? 0 : y - (item.y ?? 0),
            z === undefined ? 0 : z - item.z,
          ]);
          for (let i = 0; i < 3; i++) offset[i]! += delta[i]!;
          Object.assign(object, other);
        } else Object.assign(object, fields);
      }
      after?.(document);
    });
  }

  transformMany(
    ids: readonly string[],
    fields: { x?: number; z?: number; rotation?: number; scale?: number },
  ) {
    if (!ids.length) return;
    const all = sceneItems(this.document);
    let items = all.filter((p) => ids.includes(p.placement.id));
    if (!items.length) return;
    const cx = items.reduce((v, p) => v + p.placement.x, 0) / items.length;
    const cz = items.reduce((v, p) => v + p.placement.z, 0) / items.length;
    const angle = fields.rotation ?? 0,
      factor = fields.scale ?? 1;
    const transform = (p: { x: number; z: number }) => {
      const dx = (p.x - cx) * factor,
        dz = (p.z - cz) * factor;
      return {
        x: cx + dx * Math.cos(angle) - dz * Math.sin(angle) + (fields.x ?? 0),
        z: cz + dx * Math.sin(angle) + dz * Math.cos(angle) + (fields.z ?? 0),
      };
    };
    if (angle || factor !== 1) {
      const included = new Set(this.descendants(ids));
      items = all.filter((p) => included.has(p.placement.id));
    }
    // Resolve targets against the original snapshot. A selected support carries its
    // descendants; explicitly selected children are transformed only once.
    const targets = new Map(
      items.map(({ placement: p }) => [
        p.id,
        {
          ...transform(p),
          scale: (p.scale ?? 1) * factor,
          rotation: Math.atan2(
            Math.sin((p.rotation ?? 0) + angle),
            Math.cos((p.rotation ?? 0) + angle),
          ),
        },
      ]),
    );
    // Move registered joins in the same history transaction as their assembly.
    const transformed = new Set(this.descendants(items.map((item) => item.placement.id)));
    this.applyTransforms(targets, (document) => {
      for (const overlap of document.overlaps) {
        if (!transformed.has(overlap.a) || !transformed.has(overlap.b)) continue;
        overlap.region = polygonBounds(boundsCorners(overlap.region).map(transform));
      }
    });
  }

  removeMany(ids: readonly string[]) {
    if (!ids.length) return;
    const removed = new Set(this.descendants(ids));
    this.change((d) => {
      d.objects = d.objects.filter((p) => !removed.has(p.id));
      if (d.gameplay) d.gameplay.pickups = d.gameplay.pickups.filter((p) => !removed.has(p.object));
      if (d.gameplay?.campfires)
        d.gameplay.campfires = d.gameplay.campfires.filter(
          (p) => !p.object || !removed.has(p.object),
        );
      if (d.gameplay?.interactables)
        d.gameplay.interactables = d.gameplay.interactables.filter((p) => !removed.has(p.object));
      d.propOrder = d.propOrder.filter((id) => !removed.has(id));
      d.overlaps = d.overlaps.filter((p) => !removed.has(p.a) && !removed.has(p.b));
    });
  }

  duplicateMany(ids: readonly string[]) {
    const included = new Set(this.descendants(ids));
    const originals = new Map(this.document.objects.map((object) => [object.id, object]));
    const objects = sceneItems(this.document)
      .filter((p) => included.has(p.placement.id))
      .map((p) => originals.get(p.placement.id)!);
    return this.insertFragment(objects, [{ x: 0.5, z: 0.5 }], true);
  }

  fragment(ids: readonly string[]) {
    const included = new Set(this.descendants(ids));
    const items = sceneItems(this.document);
    const objects = new Map(this.document.objects.map((object) => [object.id, object]));
    return items
      .filter((p) => included.has(p.placement.id))
      .map(({ placement: world }) => {
        const copy = structuredClone(objects.get(world.id)!) as SceneObject;
        if (copy.mount && !included.has(copy.mount.to)) {
          delete copy.mount;
          copy.role = 'upright';
          copy.x = world.x;
          copy.z = world.z;
          copy.y = world.y;
        }
        return copy;
      });
  }

  insertFragment(
    objects: readonly ContentSnapshot<SceneObject>[],
    offsets: readonly { x: number; z: number }[] = [{ x: 0, z: 0 }],
    copyGameplay = false,
  ) {
    if (!objects.length || !offsets.length) return [];
    const source = this.document as SceneDocument;
    const inserted: string[] = [];
    this.change((d) => {
      for (const { x: dx, z: dz } of offsets) {
        const copies = structuredClone(objects) as SceneObject[];
        const remap = new Map(copies.map((p) => [p.id, 'object-' + crypto.randomUUID()]));
        for (const p of copies) {
          const original = p.id;
          p.id = remap.get(original)!;
          if (p.fixture) p.fixture.id = p.id + '-flame';
          if (p.mount && remap.has(p.mount.to)) p.mount.to = remap.get(p.mount.to)!;
          else if (p.mount) {
            const support = sceneItems(this.document).find(
              (v) => v.placement.id === p.mount!.to,
            )?.placement;
            if (!support) throw new Error('Fragment attachment support is missing');
            const delta = localOffset(support, [dx, 0, dz]);
            for (let i = 0; i < 3; i++) p.mount.offset[i]! += delta[i]!;
          } else {
            p.x = p.x! + dx;
            p.z = p.z! + dz;
          }
          d.objects.push(p);
          inserted.push(p.id);
          if (copyGameplay && d.gameplay) {
            const copied = <P extends { id: string; object: string; x: number; z: number }>(
              values: readonly P[] | undefined,
              prefix: string,
            ) =>
              (values ?? [])
                .filter((v) => v.object === original)
                .map((value) => ({
                  ...structuredClone(value),
                  id: prefix + '-' + crypto.randomUUID(),
                  object: p.id,
                  x: p.x ?? value.x,
                  z: p.z ?? value.z,
                }));
            d.gameplay.pickups.push(...copied(source.gameplay?.pickups, 'pickup'));
            const interactables = copied(source.gameplay?.interactables, 'interactable');
            if (interactables.length) (d.gameplay.interactables ??= []).push(...interactables);
          }
        }
        if (copyGameplay)
          for (const overlap of source.overlaps) {
            const a = remap.get(overlap.a),
              b = remap.get(overlap.b);
            if (!a || !b) continue;
            d.overlaps.push({
              ...overlap,
              a,
              b,
              region: {
                minX: overlap.region.minX + dx,
                maxX: overlap.region.maxX + dx,
                minZ: overlap.region.minZ + dz,
                maxZ: overlap.region.maxZ + dz,
              },
            });
          }
      }
    });
    return inserted;
  }
}
