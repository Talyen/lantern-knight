import { prepare as operation0 } from './prepare/prepare-churchyard-kit';
import { prepare as operation1 } from './prepare/prepare-effects-playground';
import { prepare as operation2 } from './prepare/prepare-flat-stage';
import { prepare as operation3 } from './prepare/prepare-graveyard-art';
import { prepare as operation4 } from './prepare/prepare-graveyard-coverage';
import { prepare as operation5 } from './prepare/prepare-graveyard-ground';
import { prepare as operation6 } from './prepare/prepare-ground-proof';
import { prepare as operation7 } from './prepare/prepare-hero';
import { prepare as operation8 } from './prepare/prepare-ink';
import { prepare as operation9 } from './prepare/prepare-library';
import { prepare as operation10 } from './prepare/prepare-lighting';
import { prepare as operation11 } from './prepare/prepare-loading-media';
import { prepare as operation12 } from './prepare/prepare-masonry';
import { prepare as operation13 } from './prepare/prepare-surface-relief';
import { prepare as operation14 } from './prepare/prepare-tended-art';
import { prepare as operation15 } from './prepare/prepare-visual-effects';
import type { PreparationContext } from './context';
export const preparationOperations: Readonly<
  Record<string, (context: PreparationContext, check: boolean) => Promise<void>>
> = {
  'assets/prepare/prepare-churchyard-kit.ts': operation0,
  'assets/prepare/prepare-effects-playground.ts': operation1,
  'assets/prepare/prepare-flat-stage.ts': operation2,
  'assets/prepare/prepare-graveyard-art.ts': operation3,
  'assets/prepare/prepare-graveyard-coverage.ts': operation4,
  'assets/prepare/prepare-graveyard-ground.ts': operation5,
  'assets/prepare/prepare-ground-proof.ts': operation6,
  'assets/prepare/prepare-hero.ts': operation7,
  'assets/prepare/prepare-ink.ts': operation8,
  'assets/prepare/prepare-library.ts': operation9,
  'assets/prepare/prepare-lighting.ts': operation10,
  'assets/prepare/prepare-loading-media.ts': operation11,
  'assets/prepare/prepare-masonry.ts': operation12,
  'assets/prepare/prepare-surface-relief.ts': operation13,
  'assets/prepare/prepare-tended-art.ts': operation14,
  'assets/prepare/prepare-visual-effects.ts': operation15,
};
