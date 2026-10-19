import type { SceneObject, SceneSnapshot } from './scene-document';

/** 01 — Wayfarer Stone Ring, using the supplied 16-frame composite loop. */
export const defaultCampfireAsset = 'library-animation-cd5cf5e86d510972-576732730917';

/** Campfires without custom artwork own their visual and light at the interaction point. */
export function sceneObjects(document: SceneSnapshot): SceneSnapshot['objects'] {
  return [
    ...document.objects,
    ...(document.gameplay?.campfires ?? []).flatMap((fire): SceneObject[] =>
      fire.object
        ? []
        : [
            {
              id: 'campfire-' + fire.id,
              kind: 'prop',
              asset: defaultCampfireAsset,
              clip: 'loop',
              x: fire.x,
              z: fire.z,
              scale: 0.75,
              // The composite includes flames; its silhouette must not cast a flame-shaped shadow.
              shadow: 'none',
              label: fire.name,
              purpose: 'Wayfarer stone-ring campfire marking a place to rest and travel.',
              fixture: {
                id: 'campfire-light-' + fire.id,
                socket: [0, 0.18, 0],
                power: 1.4,
                range: 3.5,
                phase: 0.35,
                smoke: true,
                embersScale: 0.08,
              },
            },
          ],
    ),
  ];
}
