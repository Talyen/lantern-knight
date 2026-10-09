import { applySceneryPreset } from '../../src/content/scenery-presets';
import { parseSceneDocument, type SceneDocument } from '../../src/content/scene-document';

// Contract fixtures own their IDs and layout. Production compositions may change freely.
export function sceneFixture(profile: 'graveyard' | 'chapel'): SceneDocument {
  const object = (id: string, asset: string, clip: string, x: number, z: number, zone: string) => ({
    id,
    asset,
    clip,
    x,
    z,
    zone,
    kind: 'prop' as const,
    purpose: 'Contract fixture',
  });
  return parseSceneDocument({
    version: 4,
    profile,
    id: 'fixture',
    name: 'Contract fixture',
    target: 'draft',
    base: profile === 'graveyard' ? 'court' : 'upper-landing',
    hero: { x: 0, z: 0 },
    look: { rig: 'golden', look: 'diorama' },
    objects:
      profile === 'graveyard'
        ? [
            object('family-tomb-west', 'ink-scenery', 'tomb', -5.95, 1.05, 'west-burials'),
            object('grave-family-kept', 'ink-tended-marker', 'marker', -4.35, -1, 'west-burials'),
            {
              ...object('boundary-oak', 'ink-blackwood-oak', 'oak', -6.9, -1.65, 'woodland-west'),
              fade: true,
            },
            object('chapel-shell', 'ink-stage-chapel-exterior', 'shell', 0, -6.7, 'destination'),
          ]
        : [
            object('crypt-altar', 'ink-chapel-altar', 'altar', 0, -6.95, 'sanctuary'),
            {
              id: 'crypt-altar-candles',
              asset: 'ink-crypt',
              clip: 'votive-hardware',
              kind: 'prop',
              role: 'attachment',
              mount: { to: 'crypt-altar', socket: 'votive', offset: [-0.07, 1.15, 0.08] },
              zone: 'sanctuary',
            },
            object(
              'chapel-devotional-table',
              'ink-scenery',
              'offering-table',
              -4.65,
              -5.25,
              'devotional',
            ),
          ],
  });
}

export function editorSceneFixture(profile: 'graveyard' | 'chapel'): SceneDocument {
  const scene = sceneFixture(profile);
  scene.objects = scene.objects.map(applySceneryPreset);
  const count = profile === 'graveyard' ? 3 : 2;
  for (let i = 0; i < count; i++)
    scene.objects.push(
      applySceneryPreset({
        id: i === 0 ? 'gate-lamp' : `fixture-lamp-${i}`,
        asset: profile === 'graveyard' ? 'ink-graveyard-scenery' : 'ink-crypt',
        clip: profile === 'graveyard' ? 'crook-lamp' : 'votive-hardware',
        kind: 'prop',
        x: profile === 'graveyard' ? -4.25 + i * 3 : -3 + i * 6,
        z: profile === 'graveyard' ? 7.1 : 3,
        zone: profile === 'graveyard' ? 'arrival' : 'nave',
      }),
    );
  return parseSceneDocument(scene);
}
