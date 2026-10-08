import type { Source } from '../../src/assets/schema';
import { contract } from '../../src/core/camera';
const collection = 'references/art/ink-collection-01';
const canonicalHash = '74ba2c2004e5b30da8c35f192fd725957a2a24f8b26de0ad58163608cb7dd09c';
export function source(
  id: string,
  type: Source['asset']['type'],
  canvas: [number, number],
  anchor: [number, number],
  density: number,
  viewMode: NonNullable<Source['asset']['viewMode']> = 'fixed-authored',
): Source {
  return {
    schemaVersion: 2,
    asset: {
      id,
      type,
      schemaVersion: 2,
      contentVersion: 'ink-01',
      bundle: id.startsWith('ink-hero') ? 'hero' : 'room',
      status: 'proxy',
      viewMode,
      projection:
        type === 'effect' ? 'projected-world' : type === 'material' ? 'top-down' : 'painted-cutout',
      allowEmptyFrames: type === 'effect',
      atlasSize: type === 'material' ? 512 : type === 'character' ? 1024 : 2048,
      limitations: [
        'Imported reviewed study; painted camera and world registration remain provisional.',
        'Source artwork unchanged; runtime derivatives use recorded uniform resampling and padding.',
      ],
      provenance: {
        creator: 'Lantern Ink collection authors',
        license:
          'Owner-supplied project artwork; original provenance and license declarations preserved in collection manifests.',
        source: collection,
      },
      contractId: contract.id,
      bakeVersion: contract.bakeVersion,
      canvas,
      density,
      anchor,
      padding: 4,
      colorSpace: 'srgb',
      alpha: 'straight',
      recipe: 'prepare-ink-v4 / sharp-0.35.5',
      designReference: id.startsWith('ink-hero')
        ? 'libfile_0da5071239448191b6962495ce1e0164'
        : 'collection-study',
      renderStyle: 'clean-ink',
      ...(id.startsWith('ink-hero') ? { canonicalReferenceHash: canonicalHash } : {}),
      renderCategory: type === 'material' ? 'opaque' : type === 'effect' ? 'translucent' : 'cutout',
      shadow: { radius: 0.34, opacity: 0.32 },
      collisionFootprint: type === 'character' ? 'actor-definition' : 'none',
      occlusion:
        type === 'material'
          ? 'ground-plane-v1'
          : type === 'effect'
            ? 'camera-card-v1'
            : 'vertical-plane-preserved-projection-v1',
      fallbacks: {},
      dependencies: [],
      requiredClips: [],
      clips: {},
    },
    frames: [],
  };
}
