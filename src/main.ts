import { cleanupAll } from './assets/cleanup';
import './developer-nav';
import { content, gameScenes, gameAssetCatalog } from './content/game-content';
import './style.css';
import { LoadingScreen } from './loading-screen';
import { Application } from './application';
import { GamePresentation } from './presentation/game-scene';
import type { PresentationFactory } from './presentation/lifecycle';
import { createBrowserBridge } from './platform/browser-store';
import { gameUI, createGameUI } from './game-ui';
import { finishStartupTiming } from './assets/startup-timing';
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
    Object.assign(
      (...args: Parameters<PresentationFactory<GamePresentation>>) => new GamePresentation(...args),
      { prepare: (canvas: HTMLCanvasElement) => GamePresentation.prepare(canvas) },
    ),
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
    {
      startup: 'checkpoint',
      assetProfile: 'game',
      motionProbe: import.meta.env.DEV && new URLSearchParams(location.search).has('motion-probe'),
    },
  );
  app = application;
  await application.boot();
  ui.bind(application);
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(location.search),
      wind = params.get('wind-preview'),
      dodge = params.get('dodge-preview'),
      lighting = params.get('lighting-preview');
    if (lighting === 'lantern' || lighting === 'golden' || lighting === 'silver')
      application.presentation.lookRenderer.setSettings({ rig: lighting });
    const cohesion = params.get('cohesion-preview')?.split(',');
    if (cohesion)
      application.presentation.lookRenderer.setSettings({
        paintedValues: cohesion.includes('values'),
        paintedFinish: cohesion.includes('finish'),
        groundBounce: cohesion.includes('bounce'),
        tightContacts: cohesion.includes('contacts'),
      });
    if (wind === 'gust' || wind === 'leaves' || wind === 'combined')
      application.presentation.guidingWind.treatment = wind;
    if (dodge === 'dust' || dodge === 'leaves' || dodge === 'combined')
      application.presentation.combatFeedback.dodgeTreatment = dodge;
  }
  if (application.motionProbe) {
    const output = document.createElement('output');
    output.id = 'motion-probe';
    output.style.cssText =
      'position:fixed;bottom:4px;left:4px;background:#111c;color:#ddd;font:11px monospace;z-index:20;pointer-events:none';
    const download = document.createElement('button');
    download.textContent = 'Save motion trace';
    download.style.cssText = 'position:fixed;bottom:28px;left:4px;z-index:20;font:11px monospace';
    document.body.append(output, download);
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(application.motionProbe!.snapshot())], {
          type: 'application/json',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'lantern-motion.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      application.canvas.focus();
    });
    const probe = application.motionProbe;
    const timer = setInterval(() => {
      const result = probe.snapshot();
      output.textContent = `${result.frames} frames · ${result.fps.toFixed(1)} fps · frame p50/p95/p99 ${result.p50.toFixed(1)}/${result.p95.toFixed(1)}/${result.p99.toFixed(1)} ms`;
      output.dataset.recording = JSON.stringify(result);
    }, 500);
    window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
  }
  application.canvas.dataset.ready = 'true';
  performance.mark('lantern-startup:ready');
  finishStartupTiming();
}
function shutdown() {
  cleanupAll([() => ui.dispose(), () => app?.dispose(), () => loading.dispose()]);
}
window.addEventListener('beforeunload', shutdown);
void start().catch((error: Error) => {
  ui.status(`Unable to open the game: ${error.message}`, true);
  shutdown();
  ui.failure(error.message);
  console.error(error);
});
