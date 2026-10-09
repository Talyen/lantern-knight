import '../developer-nav';
import '../style.css';
import { createWorkspaceStore, fixtures, type Fixture, type PreviewContext } from './workspace';
let dispose: (() => void) | undefined;
let request = 0;
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
      void selectScene(next).catch(console.error);
    },
    resetScene: () => {
      void selectScene(scene, true).catch(console.error);
    },
    resetWorkspace: () => {
      dispose?.();
      dispose = undefined;
      store.reset();
      void selectScene('outdoor-fixture').catch(console.error);
    },
  };
  if (scene === 'effects-playground') {
    const { mountEffects } = await import('./effects');
    if (generation === request) dispose = mountEffects(context);
  } else {
    const { mountScene } = await import('./scene');
    if (generation === request) dispose = mountScene(context);
  }
}
const parameter =
  location.hash === '#effects-playground'
    ? 'effects-playground'
    : new URLSearchParams(location.search).get('scene');
let legacy: string | null = null;
try {
  legacy = sessionStorage.getItem('lantern-author-scene');
} catch {}
const selected = parameter ?? legacy ?? store.state.selected;
const initialScene = fixtures.includes(selected as Fixture)
  ? (selected as Fixture)
  : 'outdoor-fixture';
void selectScene(initialScene).catch(console.error);
window.addEventListener('beforeunload', () => {
  dispose?.();
  request++;
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose?.();
    request++;
  });
