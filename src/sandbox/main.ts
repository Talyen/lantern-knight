import '../developer-nav';
import '../style.css';
let dispose: (() => void) | undefined;
let request = 0;
async function selectScene(scene?: string, launching = false) {
  const generation = ++request;
  dispose?.();
  dispose = undefined;
  if (scene) {
    try {
      sessionStorage.setItem('lantern-author-scene', scene);
    } catch {}
  }
  if (window.lantern?.launchMode && scene && !launching) {
    await window.lantern.launchMode(scene === 'effects-playground' ? 'effects' : 'sandbox');
    return;
  }
  if (scene && !window.lantern && location.protocol !== 'lantern:') {
    const url = new URL(location.href);
    url.hash = '';
    url.searchParams.set('scene', scene);
    history.replaceState(null, '', url);
  }
  const effects = scene === 'effects-playground';
  if (effects) {
    const { mountEffects } = await import('./effects');
    if (generation === request)
      dispose = mountEffects((scene) => {
        void selectScene(scene).catch(console.error);
      });
  } else {
    const { mountScene } = await import('./scene');
    if (generation === request)
      dispose = mountScene(scene, (next) => {
        void selectScene(next).catch(console.error);
      });
  }
}
let previousScene: string | undefined;
try {
  previousScene = sessionStorage.getItem('lantern-author-scene') ?? undefined;
} catch {}
const initialScene =
  location.hash === '#effects-playground'
    ? 'effects-playground'
    : (new URLSearchParams(location.search).get('scene') ?? previousScene ?? undefined);
void selectScene(initialScene, true).catch(console.error);
window.addEventListener('beforeunload', () => {
  request++;
  dispose?.();
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    request++;
    dispose?.();
  });
