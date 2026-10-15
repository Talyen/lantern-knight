import type { WindTreatment } from '../content/guiding-wind';
import type { Presentation } from '../presentation/scene';
import type { VisualEffect } from '../content/visual-effects';
export function bindEffectControls(
  presentation: Presentation,
  change: (key: VisualEffect, enabled: boolean) => void,
  root: HTMLElement,
) {
  for (const input of root.querySelectorAll<HTMLInputElement>('[data-scene-effect]')) {
    const key = input.dataset.sceneEffect as VisualEffect;
    input.checked = presentation.visualEffects[key];
    input.onchange = () => change(key, input.checked);
  }
  const wind = root.querySelector<HTMLSelectElement>('#wind-treatment')!;
  wind.value = presentation.guidingWind.treatment;
  wind.onchange = () => (presentation.guidingWind.treatment = wind.value as WindTreatment);
  const dodge = root.querySelector<HTMLSelectElement>('#dodge-treatment')!;
  dodge.value = presentation.combatFeedback.dodgeTreatment;
  dodge.onchange = () =>
    (presentation.combatFeedback.dodgeTreatment = dodge.value as 'dust' | 'leaves' | 'combined');
}
