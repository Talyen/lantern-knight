// Only known prose paths can omit source/build/runtime checks. Unknown files
// and unavailable or empty comparisons retain source verification.
export function documentationOnly(files: readonly string[] | undefined) {
  return (
    !!files?.length &&
    files.every((file) =>
      /^(?:[^/]+\.md|docs\/.*\.md|\.agents\/.*\.md|references\/visual\/.*\.md)$/.test(file),
    )
  );
}
const policies = [
  {
    pattern: /^\.github\/actions\//,
    desktop: true,
    authoring: true,
    assets: true,
  },
  { pattern: /^tools\/ci-browser-shard\.ts$/, authoring: true },
  { pattern: /^tests\/fixtures\/rasterization\.ts$/, desktop: true, authoring: true, assets: true },
  {
    pattern:
      /^tools\/(?:(?:cli|scope-exit|json-file|verified-files|run-process|command-lane)\.ts$|assets\/(?:workspace|paths|demand(?:-plugin)?|file-delivery|download|bundles|pack|preview|cache|files|sources)\.ts$)/,
    desktop: true,
    authoring: true,
    assets: true,
  },
  {
    pattern:
      /^(assets\/|authoring\/|references\/canon\/|src\/(?:assets|content|presentation)\/|src\/core\/(?:animation|locomotion)|tools\/(?:assets\/|check-assets|check-scene-documents|select-runtime-assets|compiler|preview-session)|tests\/assets\/|package(?:-lock)?\.json$)/,
    assets: true,
  },
  {
    pattern:
      /^(electron\/|package(?:-lock)?\.json$|electron-builder.*\.json$|.*\.html$|assets\/lock\.json$|src\/core\/save\.ts$|src\/platform\/(?:bridge|settings|storage-codec)\.ts$|src\/content\/asset-catalog\.ts$|tools\/(?:build|stage-desktop-web|package|desktop|select-runtime-assets)|tools\/assets\/(?:pack|archive|bundles|workspace|publication|paths)\.ts$|tests\/(?:desktop\/|fixtures\/input\.ts$))/,
    desktop: true,
  },
  {
    pattern:
      /^(tools\/(?:scene|segmentation)\/|src\/(?:editor|sandbox)|src\/content\/(?:scene-(?:document|design)|world-art|game-content|effects-playground)|src\/presentation\/effects-playground|tests\/browser\/(?:editor|effects|fixtures\.ts$))/,
    authoring: true,
  },
  {
    pattern:
      /^(vite\.config|playwright\.config|tools\/(?:preview-session|coverage-policy|changed-files|ci-impact|verify-target|browser-tests|dev|run-process|command-lane)|\.github\/workflows\/)/,
    desktop: true,
    authoring: true,
  },
] as const;
export function coverageFor(files?: readonly string[]) {
  if (documentationOnly(files))
    return { source: false, desktop: false, authoring: false, assets: false };
  if (!files) return { source: true, desktop: true, authoring: true, assets: true };
  return {
    source: true,
    ...policies.reduce(
      (selected, policy) =>
        files.some((file) => policy.pattern.test(file))
          ? {
              desktop: selected.desktop || ('desktop' in policy && policy.desktop),
              authoring: selected.authoring || ('authoring' in policy && policy.authoring),
              assets: selected.assets || ('assets' in policy && policy.assets),
            }
          : selected,
      { desktop: false, authoring: false, assets: false },
    ),
  };
}
