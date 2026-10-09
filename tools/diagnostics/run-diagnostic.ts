import { runScenario as game } from '../smoke/game-smoke';
import { nativeScene as sandbox } from '../scene/native-scene';
import { runScenario as animation } from '../smoke/animation-smoke';
import { runScenario as hero } from '../smoke/hero-smoke';
import { runScenario as lighting } from '../smoke/lighting-smoke';
import { runScenario as effects } from '../smoke/effects-playground-smoke';
import { runScenario as preferences } from '../smoke/visual-options-smoke';
import { runScenario as scenes } from '../smoke/visual-scenes-smoke';
import { nativeScene as scene } from '../scene/native-scene';
const scenarios: Record<string, (flags: string[]) => Promise<void>> = {
  game,
  sandbox,
  animation,
  hero,
  lighting,
  effects,
  preferences,
  scenes,
  scene,
  quality: async () => {
    await import('../check-quality');
  },
};
const [name, ...flags] = process.argv.slice(2);
if (!name || !Object.hasOwn(scenarios, name)) throw new Error('Unknown diagnostic');
await scenarios[name]!(flags);
