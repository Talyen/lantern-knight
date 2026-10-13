import type { Source } from '../../src/assets/schema';

// Keep contract fixtures independent of changing production recipes. Every call
// and heading gets its own mutable objects for validation and corruption tests.
export function sourceFixture(): Source {
  const headings = ['d00', 'd45', 'd90', 'd135', 'd180', 'd225', 'd270', 'd315'];
  const actions = [
    'idle',
    'walk',
    'attack_sword_01',
    'dodge',
    'cast_lantern_flare',
    'hit',
    'death',
  ];
  return {
    schemaVersion: 2,
    asset: {
      id: 'hero-lantern-knight',
      type: 'character',
      schemaVersion: 2,
      contentVersion: '0.1.1-proxy',
      bundle: 'hero',
      status: 'proxy',
      provenance: {
        creator: 'Lantern Knight foundation',
        license: 'Project original; editable proxy, not approved art',
        source: 'temporary generated fixture + tools/diagnostic.ts',
      },
      contractId: 'lantern-camera-v2',
      bakeVersion: 2,
      canvas: [384, 432],
      density: 192,
      anchor: [192, 348],
      padding: 0,
      colorSpace: 'srgb',
      alpha: 'straight',
      recipe: 'diagnostic-v1 + diagnostic-v1',
      renderCategory: 'cutout',
      shadow: { radius: 0.3, opacity: 0.35 },
      collisionFootprint: 'hero-circle-v1',
      occlusion: 'vertical-plane-preserved-projection-v1',
      fallbacks: { run: 'walk' },
      dependencies: [],
      requiredClips: actions,
      clips: Object.fromEntries(
        actions.map((action) => [
          action,
          Object.fromEntries(
            headings.map((heading) => [
              heading,
              {
                frames: ['sample-frame'],
                durationsMs: [200],
                loop: action === 'idle' || action === 'walk',
                notifies: [],
              },
            ]),
          ),
        ]),
      ),
      designReference: 'engineering-placeholder',
      renderStyle: 'diagnostic',
    },
    frames: [
      {
        id: 'sample-frame',
        path: 'sample.png',
        origin: 'diagnostic',
        attachments: { lantern: [132.48000240325928, 202.31778001785278] },
      },
    ],
  };
}
