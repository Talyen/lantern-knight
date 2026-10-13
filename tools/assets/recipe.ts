import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRelative } from './files';
import { z } from 'zod';
import recipe from '../../assets/recipe.json';
import { projectRoot } from './paths';
const RecipeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  steps: z
    .array(
      z.strictObject({
        file: z.string(),
        freshness: z.boolean(),
        ids: z.array(z.string()).optional(),
        inputs: z.array(z.string()).optional(),
        dependsOn: z.array(z.string()).optional(),
      }),
    )
    .nonempty(),
  inputs: z.array(z.string()),
  sharedInputs: z.array(z.string()).default([]),
  authoredInputs: z.array(z.string()).optional(),
  dependencies: z.strictObject({
    devDependencies: z.array(z.string()),
    dependencies: z.array(z.string()),
  }),
});
const authoredSteps = RecipeSchema.parse(recipe).steps;
// A producer may be declared after its consumer in the authored manifest.
// Both full and scoped preparation must execute the same dependency order.
function orderedSteps() {
  const ordered: typeof authoredSteps = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (file: string) => {
    if (visited.has(file)) return;
    if (visiting.has(file)) throw new Error('Cyclic preparation dependency: ' + file);
    const step = authoredSteps.find((step) => step.file === file);
    if (!step) throw new Error('Unknown preparation dependency: ' + file);
    visiting.add(file);
    for (const dependency of step.dependsOn ?? []) visit(dependency);
    visiting.delete(file);
    visited.add(file);
    ordered.push(step);
  };
  for (const step of authoredSteps) visit(step.file);
  return ordered;
}
export const preparationSteps = orderedSteps();
export function preparationSelection(ids: readonly string[] = []) {
  if (!ids.length) return preparationSteps;
  const selected = new Set<string>();
  const visit = (file: string) => {
    if (selected.has(file)) return;
    const step = preparationSteps.find((step) => step.file === file);
    if (!step) throw new Error('Unknown preparation dependency: ' + file);
    for (const dependency of step.dependsOn ?? []) visit(dependency);
    selected.add(file);
  };
  for (const id of ids) {
    const owners = preparationSteps.filter((step) =>
      step.ids?.some((pattern) =>
        pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern,
      ),
    );
    if (!owners.length) throw new Error('No preparation owner for asset: ' + id);
    for (const owner of owners) visit(owner.file);
  }
  // Finalizers read the verified base for unaffected producers. Their full
  // dependency list orders a cold/full preparation, not a scoped refresh.
  if (selected.has('assets/prepare/prepare-hero.ts'))
    visit('assets/prepare/prepare-animation-flow.py');
  if ([...selected].some((file) => !file.endsWith('prepare-loading-media.ts'))) {
    selected.add('assets/prepare/prepare-graveyard-coverage.ts');
    selected.add('assets/prepare/prepare-lighting.ts');
  }
  selected.add('assets/prepare/prepare-image-delivery.ts');
  return preparationSteps.filter((step) => selected.has(step.file));
}
// A scoped refresh certifies only its selected owners when global inputs change.
// Carrying older selections forward would hide an unrefreshed library later.
export function mergePreparationSelections(
  previous: { recipeSha256: string; librarySha256?: string; selections?: string[] },
  ids: readonly string[],
  recipeSha256: string,
  librarySha256?: string,
) {
  const unchanged =
    previous.recipeSha256 === recipeSha256 && previous.librarySha256 === librarySha256;
  return [...new Set([...(unchanged ? (previous.selections ?? []) : []), ...ids])];
}
export function preparationLayerKey(inputs: {
  baseSha256: string;
  recipeSha256: string;
  selections: readonly string[];
  librarySha256?: string;
  gpu: boolean;
  steps: readonly { file: string }[];
}) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        inputs.baseSha256,
        inputs.recipeSha256,
        inputs.selections,
        inputs.librarySha256,
        inputs.gpu,
        inputs.steps.map((step) => step.file),
      ]),
    )
    .digest('hex')
    .slice(0, 24);
}
export function preparationStepKey(
  operation: (typeof preparationSteps)[number],
  inputs: Record<string, string>,
  digests: ReadonlyMap<string, string>,
  sourceInventory?: string,
) {
  const owned = [
    ...(recipe.sharedInputs ?? []),
    ...(operation.inputs ?? Object.keys(inputs).filter((file) => file !== 'assets/recipe.json')),
  ];
  return createHash('sha256')
    .update(
      JSON.stringify([
        'preparation-step-v2',
        operation.file,
        inputs['tools/' + operation.file],
        inputs.dependencies,
        sourceInventory,
        owned
          .filter((file) => file !== 'assets/sources.json')
          .map((file) => [file, inputs[file] ?? null]),
        (operation.dependsOn ?? []).map((file) => [file, digests.get(file)]),
        process.version,
        process.platform,
      ]),
    )
    .digest('hex');
}
export async function recipeInputs(
  read = (name: string) => fs.readFile(path.join(projectRoot, name)),
) {
  const bytes = await read('assets/recipe.json'),
    recipe = RecipeSchema.parse(JSON.parse(bytes.toString()));
  const config = JSON.parse((await read('package.json')).toString());
  const dependencies: Record<string, Record<string, string>> = {};
  for (const [group, names] of Object.entries(recipe.dependencies)) {
    dependencies[group] = {};
    for (const name of names) {
      const version = config[group]?.[name];
      if (typeof version !== 'string') throw new Error('Missing recipe dependency: ' + name);
      dependencies[group]![name] = version;
    }
  }
  const inputs: Record<string, string> = {
    dependencies: createHash('sha256').update(JSON.stringify(dependencies)).digest('hex'),
  };
  for (const name of [
    ...new Set([
      'assets/recipe.json',
      ...recipe.inputs,
      ...recipe.sharedInputs,
      ...recipe.steps.flatMap((step) => step.inputs ?? []),
      ...recipe.steps.map((step) => 'tools/' + step.file),
    ]),
  ].sort()) {
    safeRelative(name);
    inputs[name] = createHash('sha256')
      .update(name === 'assets/recipe.json' ? bytes : await read(name))
      .digest('hex');
  }
  return inputs;
}
export async function recipeHash(
  read = (name: string) => fs.readFile(path.join(projectRoot, name)),
) {
  return createHash('sha256')
    .update(JSON.stringify(await recipeInputs(read)))
    .digest('hex');
}
