import type { Presentation } from '../presentation/scene';
const toggles = [
  ['lighting-baseline', 'baseline'],
  ['lighting-enabled', 'lighting'],
  ['lighting-shadows', 'shadows'],
  ['lighting-atmosphere', 'atmosphere'],
  ['lighting-post', 'postprocessing'],
] as const;
const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
export function bindLightingControls(presentation: Presentation, saveSettings: () => void) {
  const syncLook = () => {
    const look = presentation.lookRenderer.settings;
    element<HTMLSelectElement>('#lighting-look').value = look.look;
    element<HTMLSelectElement>('#lighting-rig').value = look.rig;
    element<HTMLInputElement>('#lighting-strength').value = String(look.strength * 100);
    element('#lighting-strength-value').textContent = Math.round(look.strength * 100) + '%';
    for (const [id, key] of toggles) element<HTMLInputElement>('#' + id).checked = look[key];
  };
  const syncDof = () => {
    const percent = Math.round(presentation.depthOfField * 100);
    element<HTMLInputElement>('#lighting-dof').value = String(percent);
    element('#lighting-dof-value').textContent = percent === 0 ? 'Off' : percent + '%';
  };
  element('#lighting-dof').oninput = () => {
    presentation.setDepthOfField(Number(element<HTMLInputElement>('#lighting-dof').value) / 100);
    syncDof();
  };
  element('#lighting-dof').onchange = saveSettings;
  element('#lighting-rig').onchange = () =>
    presentation.lightingLab.setSettings({
      rig: element<HTMLSelectElement>('#lighting-rig').value as 'golden' | 'silver',
    });
  element('#lighting-look').onchange = () =>
    presentation.lightingLab.setSettings({
      look: element<HTMLSelectElement>('#lighting-look').value as 'ink' | 'diorama' | 'cinematic',
    });
  for (const [id, key] of toggles)
    element('#' + id).onchange = () =>
      presentation.lightingLab.setSettings({ [key]: element<HTMLInputElement>('#' + id).checked });
  element('#lighting-strength').oninput = () => {
    presentation.lightingLab.setSettings({
      strength: Number(element<HTMLInputElement>('#lighting-strength').value) / 100,
    });
    syncLook();
  };
  syncLook();
  syncDof();
  return { syncLook, syncDof };
}
