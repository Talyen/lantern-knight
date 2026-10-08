import bakeContract from './camera.json';
import framing from '../content/camera.json';
export { bakeContract };
// Runtime framing cannot override the prepared artwork's projection/registration.
export const cameraContract = {
  ...bakeContract,
  verticalSpan: framing.verticalSpan,
  baseline: framing.baseline,
  resize: framing.resize,
  renderScale: framing.renderScale,
  pixelRatioCap: framing.pixelRatioCap,
  budgets: framing.budgets,
  framingRange: framing.framingRange,
};
