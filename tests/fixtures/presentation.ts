import { OrthographicCamera } from 'three';
import type { PresentationLifecycle } from '../../src/presentation/lifecycle';
import { defaultVisualEffects } from '../../src/content/visual-effects';
import type { ContentRegistry } from '../../src/content/world';
import type { SceneContent } from '../../src/content/game-content';

export function presentationFixture(
  overrides: Partial<PresentationLifecycle> = {},
): PresentationLifecycle {
  return {
    camera: new OrthographicCamera(),
    generation: 0,
    verticalSpan: 9,
    depthOfField: 0,
    visualEffects: defaultVisualEffects(),
    setDepthOfField: () => {},
    setVisualEffects: () => {},
    resize: () => {},
    loadAnimationFlow: async () => {},
    warm: async () => {},
    warmPack: () => {},
    prepareAssets: async () => {},
    resetRoom: () => {},
    update: () => {},
    dispose: () => {},
    ...overrides,
  };
}
export function sceneFixture(registry: ContentRegistry): SceneContent {
  return {
    initialAssets: [],
    area: (id) => ({ area: registry.area(id), assets: [] }),
    validate: () => {},
  };
}
