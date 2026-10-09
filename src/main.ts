import './developer-nav';
import { composeSceneContent, worldVisuals } from './content/game-content';
import './style.css';
import { LoadingScreen } from './loading-screen';
import { Application } from './application';
import { GamePresentation } from './presentation/game-scene';
import { content } from './content/game-content';
import { gameCatalog } from './assets/authoring-catalog';
import { browserBridge, createBrowserBridge } from './platform/browser-store';
import { gameUI, bindGameUI, status, showPause, updateGameUI } from './game-ui';
const loading = new LoadingScreen();
document.querySelector('#app')!.innerHTML = gameUI;
document.body.classList.add('game');
let app: Application | undefined;
async function start() {
  const application = new Application(
    document.querySelector('canvas')!,
    content,
    await gameCatalog(),
    window.lantern ??
      (import.meta.env.MODE === 'sandbox' ? createBrowserBridge('preview') : browserBridge),
    composeSceneContent(content, worldVisuals),
    (...args) => new GamePresentation(...args),
    {
      status,
      pause: (value) => {
        showPause(value);
        loading.raise();
      },
      frame: () => updateGameUI(application),
      loading: loading.set,
    },
  );
  app = application;
  await application.boot();
  bindGameUI(application);
  if (window.lantern?.launchMode) {
    const button = document.createElement('button');
    button.textContent = 'Return to Sandbox';
    button.onclick = () => {
      application.pause(true);
      application.safe(() => window.lantern!.launchMode!('sandbox'));
    };
    document.querySelector('#dev-return')!.append(button);
  }
}
window.addEventListener('beforeunload', () => {
  app?.dispose();
  loading.dispose();
});
void start().catch((error: Error) => {
  app?.dispose();
  loading.dispose();
  status(`Unable to open the game: ${error.message}`, true);
  console.error(error);
});
