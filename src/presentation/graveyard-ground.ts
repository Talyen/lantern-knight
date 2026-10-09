import * as T from 'three';
import type { PackLease } from '../assets/loader';
import type { WorldVisualDefinition } from '../content/world-art';

// Entire standalone artwork pages repeat at their registered four-metre coverage.
// Routes and thresholds are separate intact authored panels, never shader paint.
export function graveyardGroundMaterial(packs: Map<string, PackLease>, art: WorldVisualDefinition) {
  const p = packs.get(art.floor);
  if (!p) throw new Error('Authored ground unavailable: ' + art.floor);
  const frame = p.manifest.frames[0]!,
    page = p.manifest.pages.find((v) => v.id === frame.page)!;
  if (
    p.manifest.asset.type !== 'material' ||
    frame.rect.join() !== [0, 0, page.width, page.height].join()
  )
    throw new Error('Ground must use a complete registered artwork page');
  const map = p.textures.get(frame.page)!;
  if (map.wrapS !== T.RepeatWrapping || map.wrapT !== T.RepeatWrapping) {
    map.wrapS = map.wrapT = T.RepeatWrapping;
    map.needsUpdate = true;
  }
  return new T.MeshBasicMaterial({ map, depthTest: true, depthWrite: false, toneMapped: false });
}
