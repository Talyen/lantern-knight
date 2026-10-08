// Frozen pre-manifest snapshot algorithm; only committed legacy pins use it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { projectRoot } from './paths';
const preparationSteps = [
  'prepare-masonry.ts',
  'prepare-ink.ts',
  'prepare-hero.ts',
  'prepare-graveyard-art.ts',
  'prepare-graveyard-ground.ts',
  'prepare-churchyard-kit.ts',
  'prepare-tended-art.ts',
  'prepare-visual-effects.ts',
  'prepare-surface-relief.ts',
  'prepare-effects-playground.ts',
  'prepare-graveyard-coverage.ts',
  'prepare-lighting.ts',
];
async function legacyInputs(
  read = (name: string) => fs.readFile(path.join(projectRoot, name)),
  listTools = () => fs.readdir(path.join(projectRoot, 'tools')),
) {
  const names = [
    'assets/sources.json',
    'authoring/surface-depth.json',
    'authoring/ground-overlays.json',
    'authoring/graveyard-art.json',
    'authoring/chapel-art.json',
    'authoring/hero-actions.json',
    'authoring/hero-motion.json',
    'tools/assets/hero.py',
    'tools/assets/definition.ts',
    'src/assets/camera.json',
    'src/assets/camera-calibration.ts',
    'src/assets/normal-pixels.ts',
    'src/assets/schema.ts',
    'src/content/scenery-registration.ts',
    'src/content/graveyard-registration.ts',
    'src/content/asset-catalog.ts',
    'src/content/visual-effects-assets.ts',
    'src/content/effects-playground-assets.ts',
    'tools/compiler.ts',
    'tools/prepare-animation-flow.py',
    'tools/assets/io.ts',
    'tools/assets/sources.ts',
    'tools/assets/source.py',
    'tools/assets/resolver.py',
    'tools/assets/paths.ts',
    'src/assets/registration.ts',
    'tools/assets/prepare.ts',
    'tools/run-process.ts',
    'tools/assets/pack.ts',
    'tools/assets/payload.ts',
    'tools/assets/preparation-steps.ts',
    ...preparationSteps.map((n) => 'tools/' + n),
  ];
  const config = JSON.parse((await read('package.json')).toString());
  const inputs: Record<string, string> = {
    dependencies: createHash('sha256')
      .update(
        JSON.stringify({
          sharp: config.devDependencies.sharp,
          three: config.dependencies.three,
          zod: config.dependencies.zod,
          tar: config.devDependencies.tar,
        }),
      )
      .digest('hex'),
  };
  for (const name of [...new Set(names)].sort())
    inputs[name] = createHash('sha256')
      .update(await read(name))
      .digest('hex');
  return inputs;
}
async function preparationRecipeHash(
  read = (name: string) => fs.readFile(path.join(projectRoot, name)),
  listTools = () => fs.readdir(path.join(projectRoot, 'tools')),
) {
  return createHash('sha256')
    .update(JSON.stringify(await legacyInputs(read, listTools)))
    .digest('hex');
}

export async function legacyRecipeHash(
  read = (name: string) => fs.readFile(path.join(projectRoot, name)),
  listTools = () => fs.readdir(path.join(projectRoot, 'tools')),
) {
  const source = (await read('tools/assets/pack.ts')).toString();
  if (source.includes('export async function recipeInputs'))
    return preparationRecipeHash(read, listTools);
  if (!source.includes('(await listTools()).filter'))
    throw new Error('Unsupported legacy recipe algorithm');
  const names = [
    'assets/sources.json',
    'authoring/surface-depth.json',
    'authoring/graveyard-art.json',
    'authoring/chapel-art.json',
    'authoring/hero-actions.json',
    'authoring/hero-motion.json',
    'tools/assets/hero.py',
    'tools/assets/definition.ts',
    'src/content/camera.json',
    'src/assets/schema.ts',
    'src/content/scenery-registration.ts',
    'src/content/graveyard-registration.ts',
    'src/content/graveyard-scene.ts',
    'src/content/crypt-scene.ts',
    'src/content/graveyard-layout.ts',
    'src/content/visuals.ts',
    'src/content/effects-playground-assets.ts',
    'src/presentation/lighting-profiles.ts',
    'tools/compiler.ts',
    'tools/prepare-animation-flow.py',
    'tools/assets/io.ts',
    'tools/assets/sources.ts',
    'tools/assets/source.py',
    'tools/assets/resolver.py',
    'tools/assets/paths.ts',
    'src/assets/registration.ts',
    'tools/assets/prepare.ts',
    'tools/assets/payload.ts',
  ];
  const config = JSON.parse((await read('package.json')).toString());
  const digest = createHash('sha256').update(
    JSON.stringify({
      sharp: config.devDependencies.sharp,
      three: config.dependencies.three,
      zod: config.dependencies.zod,
      tar: config.devDependencies.tar,
    }),
  );
  for (const name of [
    ...new Set([
      ...names,
      ...(await listTools())
        .filter((n) => n.startsWith('prepare-') && n.endsWith('.ts'))
        .map((n) => 'tools/' + n),
    ]),
  ].sort()) {
    digest.update(name + '\0');
    digest.update(await read(name));
  }
  return digest.digest('hex');
}
