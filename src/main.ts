import { cleanupAll } from './assets/cleanup';
import './developer-nav';
import { content, gameScenes, gameAssetCatalog } from './content/game-content';
import './style.css';
import { LoadingScreen } from './loading-screen';
import { Application } from './application';
import { GamePresentation } from './presentation/game-scene';
import { createBrowserBridge } from './platform/browser-store';
import { gameUI, createGameUI } from './game-ui';
const loading = new LoadingScreen();
document.querySelector('#app')!.innerHTML = gameUI;
document.body.classList.add('game');
const ui = createGameUI(document.querySelector<HTMLElement>('.game-stage')!);
let app: Application | undefined;
async function start() {
  const application = new Application(
    document.querySelector('canvas')!,
    gameAssetCatalog,
    window.lantern ??
      createBrowserBridge(content, import.meta.env.MODE === 'sandbox' ? 'preview' : 'game'),
    gameScenes,
    (...args) => new GamePresentation(...args),
    {
      status: ui.status,
      pause: (value) => {
        ui.showPause(value);
        loading.raise();
      },
      frame: () => ui.update(application),
      loading: (active) => {
        if (!application.ready) loading.set(active);
        else {
          loading.set(false);
          document.body.classList.toggle('traveling', active);
        }
      },
    },
  );
  app = application;
  await application.boot();
  application.canvas.dataset.ready = 'false';
  try {
    await application.load();
  } catch (error) {
    ui.status(`Checkpoint unavailable: ${(error as Error).message}`, true);
  }
  ui.bind(application);
  application.canvas.dataset.ready = 'true';
}
function shutdown() {
  cleanupAll([() => ui.dispose(), () => app?.dispose(), () => loading.dispose()]);
}
window.addEventListener('beforeunload', shutdown);
void start().catch((error: Error) => {
  ui.status(`Unable to open the game: ${error.message}`, true);
  shutdown();
  console.error(error);
});
