import source from './valid.json';
import { parseManifest } from '../../src/assets/schema';
import { contract } from '../../src/core/camera';
export function manifestFixture(id = 'ink-hero-current') {
  return parseManifest({
    schemaVersion: 2,
    contractId: contract.id,
    bakeVersion: contract.bakeVersion,
    hash: 'a'.repeat(64),
    toolVersion: 'fixture',
    asset: { ...structuredClone(source.asset), id },
    frames: source.frames.map(({ path, ...frame }) => ({
      ...frame,
      source: path,
      page: 'atlas-0',
      rect: [0, 0, 32, 32],
      trim: [0, 0, 32, 32],
      rotated: false,
    })),
    pages: [
      {
        id: 'atlas-0',
        path: 'atlas.png',
        hash: 'b'.repeat(64),
        width: 64,
        height: 64,
        bytes: 1,
        rgbaBytes: 16384,
        extrusion: 0,
        gutter: 0,
        mipmaps: false,
      },
    ],
    bundles: { hero: { required: ['atlas-0'], optional: [], dependencies: [] } },
  });
}
