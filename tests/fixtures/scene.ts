import { emptyScene } from '../../src/editor/default-scene';
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
    ...emptyScene(profile === 'graveyard' ? 'court' : 'upper-landing'),
    version: 5,
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
