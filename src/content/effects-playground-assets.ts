import { visualEffectsCatalog } from './visual-effects-assets';
export const playgroundCatalog = {
  ...visualEffectsCatalog,
  'ink-hero-current': 'generated/ink/ink-hero-current/manifest.json',
  'ink-skeleton': 'generated/ink/ink-skeleton/manifest.json',
  'ink-scenery': 'generated/ink/ink-scenery/manifest.json',
  ...Object.fromEntries(
    ['watch', 'brazier', 'votive'].flatMap((id) => [
      [`fx-${id}-body`, `generated/dev-effects/fx-${id}-body/manifest.json`],
      [`fx-${id}-flame`, `generated/dev-effects/fx-${id}-flame/manifest.json`],
    ]),
  ),
} as const;
