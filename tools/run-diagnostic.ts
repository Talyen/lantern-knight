import { runScenario as game } from './smoke/game-smoke';
import { runScenario as sandbox } from './smoke/churchyard-smoke';
import { runScenario as animation } from './smoke/animation-smoke';
import { runScenario as hero } from './smoke/hero-smoke';
import { runScenario as lighting } from './smoke/lighting-smoke';
import { runScenario as crypt } from './smoke/crypt-smoke';
import { runScenario as graveyard } from './smoke/graveyard-smoke';
import { runScenario as effects } from './smoke/effects-playground-smoke';
import { runScenario as preferences } from './smoke/visual-options-smoke';
import { runScenario as scenes } from './smoke/visual-scenes-smoke';
import { nativeScene as scene } from './scene/native-scene';
const scenarios: Record<string, (flags: string[]) => Promise<void>> = {
  game,
  sandbox,
  animation,
  hero,
  lighting,
  crypt,
  graveyard,
  effects,
  preferences,
  scenes,
  scene,
  quality: async () => {
    await import('./check-quality');
    await import('./check-graveyard-art');
    const { inspectCrypt } = await import('./check-crypt-art');
    console.log(await inspectCrypt());
  },
};
const [name, ...flags] = process.argv.slice(2);
if (!name || !Object.hasOwn(scenarios, name)) throw new Error('Unknown diagnostic');
await scenarios[name]!(flags);
