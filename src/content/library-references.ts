import court from '../../authoring/scenes/live-court.json';
import chapel from '../../authoring/scenes/live-upper-landing.json';
export function sceneLibraryAssets(
  documents: readonly {
    objects: readonly { asset: string; fixture?: { flame?: { asset: string } } }[];
  }[],
) {
  return [
    ...new Set(
      documents
        .flatMap((d) =>
          d.objects.flatMap((p) => [p.asset, ...(p.fixture?.flame ? [p.fixture.flame.asset] : [])]),
        )
        .filter((id) => id.startsWith('library-')),
    ),
  ];
}
export const liveLibraryAssets = sceneLibraryAssets([court, chapel]);
