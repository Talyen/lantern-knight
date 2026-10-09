export type BuildProfile = 'game' | 'authoring';
export const webOutput = (profile: BuildProfile) => (profile === 'authoring' ? 'dist-dev' : 'dist');
export const electronOutput = (profile: BuildProfile) =>
  profile === 'authoring' ? 'dist-electron-dev' : 'dist-electron';
