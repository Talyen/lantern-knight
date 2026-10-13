import type { Application } from '../application';
import type { AudioCue, AudioSettings } from '../content/audio';
export const audioControls = `<fieldset class="audio-options"><legend>Sound</legend>
<label>Mute<input type="checkbox" data-audio="muted"></label>
${(['master', 'effects', 'ambience'] as const).map((key) => `<label>${key === 'master' ? 'Master volume' : key === 'effects' ? 'Sound effects' : 'Ambience'}<input type="range" min="0" max="100" step="1" data-audio="${key}"><output data-audio-value="${key}"></output></label>`).join('')}
</fieldset>`;
export function bindAudioControls(app: Application, root: ParentNode) {
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
    input.oninput = () => {
      app.audio.updateSettings({
        ...app.audio.settings,
        [key]: key === 'muted' ? input.checked : Number(input.value) / 100,
      });
      sync();
    };
    input.onchange = () => app.safe(() => app.saveSettings());
  }
}

export function bindAudioAudition(app: Application, root: ParentNode) {
  const host = root.querySelector('.audio-options');
  if (!host) return;
  const label = document.createElement('label');
  label.textContent = 'Prepared sample';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Prepared audio sample');
  for (const sample of app.audio.samples) {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = sample.id;
    select.append(option);
  }
  const play = document.createElement('button');
  play.textContent = 'Play sample';
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
            world: false,
            signal: controller.signal,
          }),
        )
        .catch(() => {});
  };
  const stop = document.createElement('button');
  stop.textContent = 'Stop sample';
  stop.onclick = () => pending?.abort();
  label.append(select);
  host.append(label, play, stop);
}
