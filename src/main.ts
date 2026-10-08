import './style.css';
import { Application } from './application';
import { GamePresentation } from './presentation/game-scene';
import { content } from './content/game-content';
import { gameAssetCatalog } from './content/visuals';
import { browserBridge, createBrowserBridge } from './platform/browser-store';
import { gameUI, bindGameUI, status, showPause, updateGameUI } from './game-ui';
document.querySelector('#app')!.innerHTML = gameUI;
document.body.classList.add('game');
const app = new Application(
  document.querySelector('canvas')!,
  content,
  gameAssetCatalog,
  window.lantern ??
    (import.meta.env.MODE === 'sandbox' ? createBrowserBridge('preview') : browserBridge),
  (...args) => new GamePresentation(...args),
  { status, pause: showPause, frame: () => updateGameUI(app) },
);
window.addEventListener('beforeunload', () => app.dispose());
app
  .boot()
  .then(() => {
    bindGameUI(app);
    if (window.lantern?.launchMode) {
      const button = document.createElement('button');
      button.textContent = 'Return to Sandbox';
      button.onclick = () => {
        app.pause(true);
        void window.lantern!.launchMode!('sandbox');
      };
      document.querySelector('#dev-return')!.append(button);
    }
  })
  .catch((error) => {
    app.dispose();
    status(`Unable to open the churchyard: ${error.message}`, true);
    console.error(error);
  });
