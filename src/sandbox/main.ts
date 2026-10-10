import { authoringCatalog } from '../assets/authoring-catalog';
import '../developer-nav';
import '../style.css';
import { createWorkspaceStore, fixtures, type Fixture, type PreviewContext } from './workspace';
let dispose: (() => void) | undefined;
let request = 0;
let assetToPreview: string | undefined;
let catalogRequest: AbortController | undefined;
const store = createWorkspaceStore({
  getItem: (key) => sessionStorage.getItem(key),
  setItem: (key, value) => sessionStorage.setItem(key, value),
});
function save() {
  store.save();
}
async function selectScene(scene: Fixture, reset = false) {
  dispose?.();
  dispose = undefined;
  catalogRequest?.abort();
  const generation = ++request;
  if (reset) delete store.state.scenes[scene];
  store.state.selected = scene;
  save();
  if (!window.lantern && location.protocol !== 'lantern:') {
    const url = new URL(location.href);
    url.hash = '';
    url.searchParams.set('scene', scene);
    history.replaceState(null, '', url);
  }
  const context: PreviewContext = {
    fixture: scene,
    assetToPreview,
    previewAsset: (id) => {
      assetToPreview = id;
      store.state.ui.panel = 'animation';
      void selectScene('outdoor-fixture').catch(launchFailure);
    },
    remembered: store.state.scenes[scene],
    ui: store.state.ui,
    remember: (state) => {
      if (generation === request) {
        store.state.scenes[scene] = state;
        save();
      }
    },
    changed: save,
    select: (next) => {
      void selectScene(next).catch(launchFailure);
    },
    resetScene: () => {
      void selectScene(scene, true).catch(launchFailure);
    },
    resetWorkspace: () => {
      dispose?.();
      dispose = undefined;
      store.reset();
      void selectScene('outdoor-fixture').catch(launchFailure);
    },
  };
  assetToPreview = undefined;
  try {
    if (scene === 'effects-playground') {
      const { mountEffects } = await import('./effects');
      if (generation === request) dispose = mountEffects(context);
    } else {
      const { mountScene } = await import('./scene');
      if (generation !== request) return;
      catalogRequest = new AbortController();
      const catalog = await authoringCatalog(catalogRequest.signal);
      if (generation === request) dispose = mountScene(context, catalog);
    }
  } catch (error) {
    if (generation === request) throw error;
  }
}
const parameter =
  location.hash === '#effects-playground'
    ? 'effects-playground'
    : new URLSearchParams(location.search).get('scene');
const selected = parameter ?? store.state.selected;
const initialScene = fixtures.includes(selected as Fixture)
  ? (selected as Fixture)
  : 'outdoor-fixture';
void selectScene(initialScene).catch(launchFailure);
window.addEventListener('beforeunload', () => {
  dispose?.();
  request++;
  catalogRequest?.abort();
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose?.();
    request++;
  });

function launchFailure(error: Error) {
  if (error.name === 'AbortError') return;
  const root = document.getElementById('app')!;
  const message = document.createElement('p');
  message.role = 'alert';
  message.textContent = error.message;
  const retry = document.createElement('button');
  retry.textContent = 'Retry';
  retry.onclick = () => {
    void selectScene(store.state.selected).catch(launchFailure);
  };
  root.replaceChildren(message, retry);
}
