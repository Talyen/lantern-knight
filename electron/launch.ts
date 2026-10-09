import path from 'node:path';
export type LaunchMode = 'game' | 'sandbox' | 'effects' | 'editor';
export const launchEntry = (dev: boolean, mode: LaunchMode) =>
  dev && mode === 'editor'
    ? 'editor.html'
    : dev && mode === 'effects'
      ? 'sandbox.html#effects-playground'
      : dev && mode === 'sandbox'
        ? 'sandbox.html'
        : 'index.html';
export const checkpointDirectory = (root: string, dev: boolean, mode: LaunchMode) =>
  path.join(
    root,
    ...(dev ? [mode === 'game' ? 'preview' : mode === 'effects' ? 'sandbox' : mode] : []),
    'prototype-saves',
  );
