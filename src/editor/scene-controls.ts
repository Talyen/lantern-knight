import type { SceneDocument } from '../content/scene-document';
const cameraKeys = ['minX', 'maxX', 'minZ', 'maxZ'] as const;
export const sceneControlsHTML = `<fieldset><legend>Camera framing</legend>${cameraKeys.map((key) => `<label>${key}<input id="camera-${key}" type="number" step="0.1"></label>`).join('')}<label>Bias X<input id="camera-bias-x" type="number" step="0.1"></label><label>Bias Z<input id="camera-bias-z" type="number" step="0.1"></label></fieldset><fieldset id="geometry-controls"><legend>Playable bounds</legend>${cameraKeys.map((key) => `<label>${key}<input id="geometry-${key}" type="number" step="0.1"></label>`).join('')}</fieldset>`;
export function bindSceneControls(
  change: (mutator: (document: SceneDocument) => void) => Promise<void>,
) {
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  for (const key of cameraKeys) {
    input('camera-' + key).onchange = () => {
      change((d) => {
        d.camera.bounds[key] = Number(input('camera-' + key).value);
      }).catch(console.error);
    };
    input('geometry-' + key).onchange = () => {
      change((d) => {
        if (d.geometry) d.geometry.bounds[key] = Number(input('geometry-' + key).value);
      }).catch(console.error);
    };
  }
  for (const axis of ['x', 'z'] as const)
    input('camera-bias-' + axis).onchange = () => {
      change((d) => {
        d.camera.bias[axis] = Number(input('camera-bias-' + axis).value);
      }).catch(console.error);
    };
  return (d: SceneDocument, busy: boolean) => {
    for (const key of cameraKeys) {
      input('camera-' + key).value = String(d.camera.bounds[key]);
      input('camera-' + key).disabled = busy;
      input('geometry-' + key).value = String(d.geometry?.bounds[key] ?? 0);
      input('geometry-' + key).disabled = busy;
    }
    for (const axis of ['x', 'z'] as const) {
      input('camera-bias-' + axis).value = String(d.camera.bias[axis]);
      input('camera-bias-' + axis).disabled = busy;
    }
    document.getElementById('geometry-controls')!.hidden = !d.geometry;
  };
}
