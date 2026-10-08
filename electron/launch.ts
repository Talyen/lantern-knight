import path from 'node:path';
export type LaunchMode = 'game' | 'sandbox' | 'effects';
export const launchEntry = (dev: boolean, mode: LaunchMode) =>
  dev && mode === 'effects'
    ? 'effects.html'
    : dev && mode === 'sandbox'
      ? 'sandbox.html'
      : 'index.html';
export const checkpointDirectory = (root: string, dev: boolean, mode: LaunchMode) =>
  path.join(
    root,
    ...(dev ? [mode === 'game' ? 'preview' : mode === 'effects' ? 'effects' : 'sandbox'] : []),
    'saves',
  );
