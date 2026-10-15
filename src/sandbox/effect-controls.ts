import type { WindTreatment } from '../content/guiding-wind';
import type { Presentation } from '../presentation/scene';
import { visualEffectLabels, type VisualEffect } from '../content/visual-effects';
export function bindEffectControls(
  presentation: Presentation,
  change: (key: VisualEffect, enabled: boolean) => void,
  root: HTMLElement,
) {
  const panel = document.createElement('fieldset');
  panel.innerHTML = '<legend>Scene effects</legend>';
  for (const [key, label] of Object.entries(visualEffectLabels)) {
    const row = document.createElement('label'),
      input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.sceneEffect = key;
    input.checked = presentation.visualEffects[key as VisualEffect];
    input.onchange = () => change(key as VisualEffect, input.checked);
    row.append(label, input);
    panel.append(row);
  }
  const windLabel = document.createElement('label'),
    windSelect = document.createElement('select');
  windLabel.append('Guiding wind');
  for (const [value, text] of [
    ['gust', 'Autumn gust'],
    ['leaves', 'Falling leaves'],
    ['combined', 'Layered gust'],
  ]) {
    const option = document.createElement('option');
    option.value = value!;
    option.textContent = text!;
    windSelect.append(option);
  }
  windSelect.value = presentation.guidingWind.treatment;
  windSelect.onchange = () => {
    presentation.guidingWind.treatment = windSelect.value as WindTreatment;
  };
  windLabel.append(windSelect);
  panel.append(windLabel);
  const dodgeLabel = document.createElement('label'),
    dodgeSelect = document.createElement('select');
  dodgeLabel.append('Dodge trail');
  for (const [value, text] of [
    ['dust', 'Dust wake'],
    ['leaves', 'Leaves'],
    ['combined', 'Dust and leaves'],
  ]) {
    const option = document.createElement('option');
    option.value = value!;
    option.textContent = text!;
    dodgeSelect.append(option);
  }
  dodgeSelect.value = presentation.combatFeedback.dodgeTreatment;
  dodgeSelect.onchange = () => {
    presentation.combatFeedback.dodgeTreatment = dodgeSelect.value as
      'dust' | 'leaves' | 'combined';
  };
  dodgeLabel.append(dodgeSelect);
  panel.append(dodgeLabel);
  root.querySelector('#scene-effects')!.append(panel);
}
