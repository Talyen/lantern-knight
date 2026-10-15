import { cleanupAll } from '../assets/cleanup';
import { authoringCatalog } from '../assets/authoring-catalog';
import '../developer-nav';
import '../style.css';
import { createWorkspaceStore, fixtures, type Fixture, type PreviewContext } from './workspace';
let dispose: (() => void) | undefined;
let mountedGeneration: number | undefined;
let retiringGeneration: number | undefined;
let request = 0;
let closed = false;
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
  if (closed) return;
  const generation = ++request;
  retireFixture();
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
      if (closed || generation !== request) return;
      assetToPreview = id;
      store.state.ui.panel = 'animation';
      void selectScene('outdoor-fixture').catch(launchFailure);
    },
    remembered: store.state.scenes[scene],
    ui: store.state.ui,
    remember: (state) => {
      if ((!closed && generation === request) || generation === retiringGeneration) {
        store.state.scenes[scene] = state;
        save();
      }
    },
    changed: () => {
      if (!closed && generation === request) save();
    },
    select: (next) => {
      if (!closed && generation === request) void selectScene(next).catch(launchFailure);
    },
    resetScene: () => {
      if (!closed && generation === request) void selectScene(scene, true).catch(launchFailure);
    },
    resetWorkspace: () => {
      if (closed || generation !== request) return;
      // Retire before clearing the workspace so its final snapshot cannot return.
      request++;
      retireFixture();
      store.reset();
      void selectScene('outdoor-fixture').catch(launchFailure);
    },
  };
  assetToPreview = undefined;
  try {
    if (scene === 'effects-playground') {
      const { mountEffects } = await import('./effects');
      if (generation === request) {
        dispose = mountEffects(context);
        mountedGeneration = generation;
      }
    } else {
      const { mountScene } = await import('./scene');
      if (generation !== request) return;
      catalogRequest = new AbortController();
      const catalog = await authoringCatalog(catalogRequest.signal);
      if (generation === request) {
        dispose = mountScene(context, catalog);
        mountedGeneration = generation;
      }
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
function retireFixture() {
  const previous = dispose,
    pending = catalogRequest;
  dispose = undefined;
  catalogRequest = undefined;
  // The outgoing owner may publish its last synchronous snapshot while closing.
  // This capability ends before any pending callback or successor can run.
  retiringGeneration = mountedGeneration;
  mountedGeneration = undefined;
  try {
    cleanupAll([() => pending?.abort(), () => previous?.()]);
  } finally {
    retiringGeneration = undefined;
  }
}
function close() {
  if (closed) return;
  closed = true;
  request++;
  window.removeEventListener('beforeunload', close);
  retireFixture();
}
window.addEventListener('beforeunload', close);
if (import.meta.hot) import.meta.hot.dispose(close);

function launchFailure(error: Error) {
  if (closed) return;
  if (error.name === 'AbortError') return;
  const root = document.getElementById('app')!;
  const message = document.createElement('p');
  message.role = 'alert';
  message.textContent = error.message;
  const retry = document.createElement('button');
  retry.textContent = 'Retry';
  retry.onclick = () => void selectScene(store.state.selected).catch(launchFailure);
  root.replaceChildren(message, retry);
}
