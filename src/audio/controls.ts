import type { Application } from '../application';
import type { AudioCue, AudioSettings } from '../content/audio';
export const audioControls = (
  audition = false,
) => `<fieldset class="audio-options"><legend>Sound</legend>
<label>Mute<input type="checkbox" data-audio="muted"></label>
${(['master', 'effects', 'ambience'] as const).map((key) => `<label>${key === 'master' ? 'Master volume' : key === 'effects' ? 'Sound effects' : 'Ambience'}<input type="range" min="0" max="100" step="1" data-audio="${key}"><output data-audio-value="${key}"></output></label>`).join('')}
${audition ? '<label>Prepared sample<select aria-label="Prepared audio sample" data-audio-sample></select></label><button data-audio-play>Play sample</button><button data-audio-stop>Stop sample</button>' : ''}
</fieldset>`;
export function bindAudioControls(app: Application, root: ParentNode, signal?: AbortSignal) {
  for (const input of root.querySelectorAll<HTMLInputElement>('[data-audio]')) {
    const key = input.dataset.audio as keyof AudioSettings;
    const output = root.querySelector<HTMLOutputElement>(`[data-audio-value="${key}"]`);
    const sync = () => {
      if (key === 'muted') input.checked = app.audio.settings.muted;
      else {
        input.value = String(Math.round(app.audio.settings[key] * 100));
        if (output) output.value = input.value + '%';
      }
    };
    sync();
    input.addEventListener(
      'input',
      () => {
        app.audio.updateSettings({
          ...app.audio.settings,
          [key]: key === 'muted' ? input.checked : Number(input.value) / 100,
        });
        sync();
      },
      { signal },
    );
    input.addEventListener('change', () => app.safe(() => app.saveSettings()), { signal });
  }
}

export function bindAudioAudition(app: Application, root: ParentNode) {
  const host = root.querySelector('.audio-options');
  if (!host) return;
  const select = host.querySelector<HTMLSelectElement>('[data-audio-sample]')!;
  select.replaceChildren(...app.audio.samples.map((sample) => new Option(sample.id, sample.id)));
  const play = host.querySelector<HTMLButtonElement>('[data-audio-play]')!;
  let pending: AbortController | undefined;
  play.onclick = () => {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const sample = app.audio.samples.find((s) => s.id === select.value);
    if (sample)
      void app.audio
        .unlock()
        .then(() =>
          app.audio.play(sample.cue as AudioCue, {
            sampleId: sample.id,
            key: sample.id,
            world: false,
            signal: controller.signal,
          }),
        )
        .catch(() => {});
  };
  host.querySelector<HTMLButtonElement>('[data-audio-stop]')!.onclick = () => pending?.abort();
}
