// One policy owns optional CI tiers. Every change still runs source, Game and scene checks.
const policies = [
  {
    pattern:
      /^(electron\/|package(?:-lock)?\.json$|electron-builder.*\.json$|.*\.html$|assets\/lock\.json$|src\/core\/save\.ts$|src\/content\/asset-catalog\.ts$|tools\/(?:build|package|desktop|select-runtime-assets)|tools\/assets\/(?:pack|archive|bundles|workspace|publication|paths)\.ts$|tests\/desktop\/)/,
    desktop: true,
  },
  {
    pattern:
      /^(src\/(?:editor|effects-playground|sandbox)|src\/content\/(?:scene-(?:document|design)|world-art|game-content|effects-playground)|src\/presentation\/effects-playground|tests\/browser\/(?:editor|effects))/,
    authoring: true,
  },
  {
    pattern:
      /^(vite\.config|playwright\.config|tools\/(?:preview-session|coverage-policy|ci-impact|browser-tests|dev|run-process|command-lane)|\.github\/workflows\/)/,
    desktop: true,
    authoring: true,
  },
] as const;
export function coverageFor(files?: readonly string[]) {
  if (!files) return { desktop: true, authoring: true };
  return policies.reduce(
    (selected, policy) =>
      files.some((file) => policy.pattern.test(file))
        ? {
            desktop: selected.desktop || ('desktop' in policy && policy.desktop),
            authoring: selected.authoring || ('authoring' in policy && policy.authoring),
          }
        : selected,
    { desktop: false, authoring: false },
  );
}
