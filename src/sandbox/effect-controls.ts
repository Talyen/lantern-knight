import type { Presentation } from '../presentation/scene';
import { visualEffectLabels, type VisualEffect } from '../content/visual-effects';
export function bindEffectControls(presentation: Presentation) {
  const panel = document.createElement('fieldset');
  panel.innerHTML = '<legend>Scene effects</legend>';
  for (const [key, label] of Object.entries(visualEffectLabels)) {
    const row = document.createElement('label'),
      input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.sceneEffect = key;
    input.checked = presentation.visualEffects[key as VisualEffect];
    input.onchange = () => presentation.setVisualEffects({ [key]: input.checked });
    row.append(label, input);
    panel.append(row);
  }
  document.querySelector('#lighting-lab')!.append(panel);
}
