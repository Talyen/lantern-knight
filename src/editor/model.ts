import {
  parseSceneDocument,
  editablePlacement,
  placementAsset,
  type SceneDocument,
  type SceneObject,
} from '../content/scene-document';
import { resolveAuthoredScene, type ArtPlacement } from '../content/world-art';
export type EditorItem = { placement: ArtPlacement; kind: 'prop' | 'decal'; locked: boolean };
export function sceneItems(document: SceneDocument): EditorItem[] {
  const art = resolveAuthoredScene(document);
  return [
    ...art.props.map((placement) => ({
      placement,
      kind: 'prop' as const,
      locked:
        !document.objects.some((p) => p.id === placement.id) && !editablePlacement(placement, art),
    })),
    ...art.decals.map((placement) => ({ placement, kind: 'decal' as const, locked: false })),
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
      const added = d.objects.find((p) => p.id === id);
      if (added) Object.assign(added, fields);
      else {
        let c = d.changes.find((p) => p.id === id);
        if (!c) {
          c = { id, x: item.placement.x, z: item.placement.z };
          d.changes.push(c);
        }
        Object.assign(c, fields);
      }
    });
  }
  remove(id: string) {
    const item = sceneItems(this.document).find((p) => p.placement.id === id);
    if (!item || item.locked) throw new Error('Object is locked');
    this.change((d) => {
      if (d.objects.some((p) => p.id === id)) d.objects = d.objects.filter((p) => p.id !== id);
      else {
        d.changes = d.changes.filter((p) => p.id !== id);
        d.changes.push({ id, x: item.placement.x, z: item.placement.z, deleted: true });
      }
    });
  }
  duplicate(id: string) {
    const item = sceneItems(this.document).find((p) => p.placement.id === id);
    if (!item || item.locked) throw new Error('Object is locked');
    const p = item.placement,
      newId = 'object-' + crypto.randomUUID();
    this.change((d) =>
      d.objects.push({
        id: newId,
        kind: item.kind,
        asset: placementAsset(p, item.kind),
        clip: p.clip,
        x: p.x + 0.5,
        z: p.z + 0.5,
        y: p.y,
        scale: p.scale,
        mirror: p.mirror,
        tint: p.tint,
        opacity: p.opacity,
        fade: p.fade,
        shadow: p.shadow,
        ...(item.kind === 'decal' ? { rotation: p.rotation } : {}),
      }),
    );
    return newId;
  }
}
