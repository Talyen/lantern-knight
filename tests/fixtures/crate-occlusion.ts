import source from './crate-occlusion.json';
import { parseSceneDocument } from '../../src/content/scene-document';

// A preserved excerpt of the original orchard defect; production scenes remain editable.
export function crateOcclusionFixture() {
  const document = parseSceneDocument(structuredClone(source));
  const crate = document.groundInteraction!.regions.find((r) => r.id === 'orchard-scenery-10')!;
  return { document, crate };
}
